import { addExactDays, parseInstant } from "@dls/domain";
import type { TransactionManager } from "../ports/transaction-manager.js";
import {
  activeRecovery,
  digestSecret,
  RecoveryError,
  recoveryBytes,
  recoveryInteger,
  recoveryRepository,
} from "./recovery-common.js";

export type StartRecoveryResult = Readonly<{
  workflowId: string;
  expiresAt: string;
  requiredCount: number;
}>;

export async function startRecovery(
  command: Readonly<{ token: string; requestId: string }>,
  dependencies: Readonly<{
    transaction: TransactionManager;
    tokenPepper: Uint8Array;
    idFactory?: () => string;
  }>,
): Promise<StartRecoveryResult> {
  return dependencies.transaction.run(async (tx) => {
    const tokens = recoveryRepository(tx.repositories.oneTimeTokens, "one-time tokens");
    const token = await tokens.findOneBy?.(
      "token_hash",
      digestSecret(command.token, dependencies.tokenPepper),
      { forUpdate: true },
    );
    const now = await tx.clock.now();
    if (
      token === null ||
      token === undefined ||
      token.purpose !== "ADMIN_RECOVERY_START" ||
      token.consumed_at !== null ||
      token.revoked_at !== null ||
      typeof token.expires_at !== "string" ||
      Date.parse(now) >= Date.parse(token.expires_at)
    ) {
      throw new RecoveryError("DLS-RECOVERY-START-INVALID", "recovery start token is invalid", 400);
    }
    const workflows = (await tx.repositories.workflows.findMany?.()) ?? [];
    const existing = activeRecovery(workflows);
    if (existing !== undefined) {
      return {
        workflowId: String(existing.id),
        expiresAt: parseInstant(String(existing.expires_at)),
        requiredCount: Number(existing.required_count_snapshot),
      };
    }
    if (
      workflows.some(
        (row) =>
          row.kind === "DEATH_CONFIRMATION" &&
          !["CANCELLED", "RELEASED", "EXPIRED", "COMPLETED"].includes(String(row.state)),
      )
    ) {
      throw new RecoveryError(
        "DLS-RECOVERY-DEATH-PRIORITY",
        "death confirmation has priority over password recovery",
        409,
      );
    }
    const owner = await tx.repositories.ownerProfile.findById(true, { forUpdate: true });
    const settings = await tx.repositories.systemSettings.findById(true, { forUpdate: true });
    const generation = await recoveryRepository(
      tx.repositories.shareGenerations,
      "share generations",
    ).findOneBy?.("status", "ACTIVE", { forUpdate: true });
    if (owner === null || settings === null || generation === null || generation === undefined) {
      throw new RecoveryError("DLS-RECOVERY-UNAVAILABLE", "recovery snapshot is unavailable", 503);
    }
    const generationId = String(generation.id);
    const vault = await tx.repositories.vaults.findById(String(generation.vault_id), {
      forUpdate: true,
    });
    const activePackage = await tx.repositories.packages.findOneBy?.("status", "ACTIVE", {
      forUpdate: true,
    });
    const schedule =
      (await tx.repositories.checkinSchedules.findOneBy?.("status", "ACTIVE", {
        forUpdate: true,
      })) ?? (await tx.repositories.checkinSchedules.findFirst?.({ forUpdate: true }));
    if (
      vault === null ||
      String(vault.active_share_generation_id) !== generationId ||
      activePackage === null ||
      activePackage === undefined ||
      schedule === null ||
      schedule === undefined
    ) {
      throw new RecoveryError("DLS-RECOVERY-UNAVAILABLE", "recovery snapshot is unavailable", 503);
    }
    const contacts = [
      ...((await tx.repositories.contacts.findMany?.("status", "ACTIVE", {
        forUpdate: true,
      })) ?? []),
    ].sort((left, right) => String(left.id).localeCompare(String(right.id)));
    const count = recoveryInteger(generation.contact_count, "contact count");
    const requiredCount = recoveryInteger(generation.recovery_threshold, "recovery threshold");
    if (contacts.length !== count || requiredCount !== Math.floor(count / 2) + 1) {
      throw new RecoveryError("DLS-RECOVERY-UNAVAILABLE", "recovery threshold is invalid", 503);
    }
    const shares =
      (await recoveryRepository(tx.repositories.contactKeyShares, "contact key shares").findMany?.(
        "generation_id",
        generationId,
        { forUpdate: true },
      )) ?? [];
    if (shares.length !== count) {
      throw new RecoveryError("DLS-RECOVERY-UNAVAILABLE", "recovery shares are incomplete", 503);
    }
    const workflowId = dependencies.idFactory?.() ?? crypto.randomUUID();
    const expiresAt = addExactDays(now, 7);
    await tx.repositories.workflows.insert({
      id: workflowId,
      kind: "PASSWORD_RECOVERY",
      state: "AWAITING_APPROVALS",
      contact_count_snapshot: count,
      required_count_snapshot: requiredCount,
      approved_count: 0,
      share_generation_id: generationId,
      package_id: activePackage.id,
      package_version_snapshot: recoveryInteger(activePackage.version_no, "package version"),
      schedule_version_snapshot: recoveryInteger(schedule.schedule_version, "schedule version"),
      deadline_snapshot_at: parseInstant(String(schedule.deadline_at)),
      owner_display_name_snapshot_ciphertext: recoveryBytes(
        owner.display_name_ciphertext,
        "owner display name",
      ),
      owner_display_name_snapshot_nonce: recoveryBytes(owner.display_name_nonce, "owner nonce"),
      owner_display_name_snapshot_key_version: recoveryInteger(
        owner.display_name_key_version,
        "owner key version",
      ),
      started_at: now,
      expires_at: expiresAt,
    });
    const snapshots = recoveryRepository(tx.repositories.workflowContacts, "workflow contacts");
    for (const [position, contact] of contacts.entries()) {
      const share = shares.find((row) => String(row.contact_id) === String(contact.id));
      if (share === undefined) {
        throw new RecoveryError("DLS-RECOVERY-UNAVAILABLE", "recovery share is missing", 503);
      }
      await snapshots.insert({
        workflow_id: workflowId,
        contact_id: contact.id,
        snapshot_position: position + 1,
        share_index: recoveryInteger(share.share_index, "share index"),
        contact_public_key: recoveryBytes(contact.x25519_public_key, "contact public key", 32),
        contact_set_version: recoveryInteger(settings.contact_set_version, "contact set version"),
        display_name_snapshot_ciphertext: recoveryBytes(contact.display_name_ciphertext, "name"),
        display_name_snapshot_nonce: recoveryBytes(contact.display_name_nonce, "name nonce"),
        display_name_snapshot_key_version: recoveryInteger(
          contact.display_name_key_version,
          "name key version",
        ),
        email_snapshot_ciphertext: recoveryBytes(contact.email_ciphertext, "email"),
        email_snapshot_nonce: recoveryBytes(contact.email_nonce, "email nonce"),
        email_snapshot_key_version: recoveryInteger(contact.email_key_version, "email key version"),
        email_snapshot_lookup_hmac: recoveryBytes(contact.email_lookup_hmac, "email lookup"),
      });
    }
    await tokens.updateById?.(token.id, { consumed_at: now });
    await tx.outbox.enqueue({
      eventType: "PASSWORD_RECOVERY_STARTED",
      aggregateType: "workflow",
      aggregateId: workflowId,
      payload: { aggregateId: workflowId, aggregateVersion: 0, expiresAt },
      idempotencyKey: `password-recovery-started:${workflowId}`,
      availableAt: now,
    });
    await tx.audit.append({
      eventId: crypto.randomUUID(),
      occurredAt: now,
      eventType: "PASSWORD_RECOVERY_STARTED",
      actorType: "OWNER_EMAIL",
      aggregateType: "workflow",
      aggregateId: workflowId,
      requestId: command.requestId,
      result: "SUCCESS",
      metadata: { requiredCount, expiresAt },
    });
    return { workflowId, expiresAt, requiredCount };
  });
}
