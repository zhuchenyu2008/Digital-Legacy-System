import type { TransactionManager } from "../ports/transaction-manager.js";
import {
  activeContactRows,
  bytes,
  contactsFromRows,
  equalBytes,
  getNowAndId,
  ShareGenerationError,
  shareRepository,
  snapshotDigest,
} from "./share-generation-common.js";

export type ActivateShareGenerationCommand = Readonly<{
  ownerId: string;
  generationId: string;
  expectedCurrentGenerationId?: string;
  contactSetVersion: number;
  requestId: string;
}>;

export type ActivateShareGenerationResult = Readonly<{
  generationId: string;
  status: "ACTIVE";
  contactCount: number;
  deathThreshold: number;
  recoveryThreshold: number;
  systemState: "READY" | "ARMED";
}>;

export async function activateShareGeneration(
  command: ActivateShareGenerationCommand,
  dependencies: Readonly<{ transaction: TransactionManager; idFactory?: () => string }>,
): Promise<ActivateShareGenerationResult> {
  const idFactory = dependencies.idFactory ?? (() => crypto.randomUUID());
  return dependencies.transaction.run(
    async (tx) => {
      const generations = shareRepository(tx.repositories.shareGenerations, "share generations");
      const keyShares = shareRepository(tx.repositories.contactKeyShares, "contact key shares");
      const generation = await generations.findById(command.generationId, { forUpdate: true });
      if (generation === null || generation.status !== "PREPARING") {
        throw new ShareGenerationError(
          "DLS-SHARE-GENERATION-MISMATCH",
          "generation is not activatable",
          409,
        );
      }
      const vault = await tx.repositories.vaults.findById(String(generation.vault_id), {
        forUpdate: true,
      });
      if (vault === null)
        throw new ShareGenerationError(
          "DLS-SHARE-GENERATION-MISMATCH",
          "vault is unavailable",
          404,
        );
      const currentGenerationId =
        vault.active_share_generation_id === null || vault.active_share_generation_id === undefined
          ? undefined
          : String(vault.active_share_generation_id);
      if (
        command.expectedCurrentGenerationId !== undefined &&
        currentGenerationId !== command.expectedCurrentGenerationId
      ) {
        throw new ShareGenerationError(
          "DLS-SHARE-GENERATION-MISMATCH",
          "current generation is stale",
          409,
        );
      }
      const settings = await tx.repositories.systemSettings.findById(true, { forUpdate: true });
      if (
        settings === null ||
        Number(settings.contact_set_version ?? -1) !== command.contactSetVersion
      ) {
        throw new ShareGenerationError(
          "DLS-SHARE-GENERATION-MISMATCH",
          "contact roster is stale",
          409,
        );
      }
      const contacts = contactsFromRows(
        activeContactRows((await tx.repositories.contacts.findMany?.()) ?? []),
      );
      if (contacts.length < 3) {
        throw new ShareGenerationError(
          "DLS-CONTACT-MINIMUM",
          "at least three active contacts are required",
          422,
        );
      }
      if (
        !equalBytes(
          snapshotDigest(contacts),
          bytes(generation.contacts_snapshot_sha256, "contacts snapshot", 32, 32),
        )
      ) {
        throw new ShareGenerationError(
          "DLS-SHARE-GENERATION-MISMATCH",
          "contact roster changed",
          409,
        );
      }
      const shares =
        (await keyShares.findMany?.("generation_id", command.generationId, { forUpdate: true })) ??
        [];
      if (shares.length !== contacts.length) {
        throw new ShareGenerationError(
          "DLS-SHARE-INVALID",
          "every active contact needs both shares",
        );
      }
      const contactIds = new Set(contacts.map((contact) => contact.contactId));
      const shareIndexes = new Set<number>();
      for (const share of shares) {
        if (!contactIds.has(String(share.contact_id)))
          throw new ShareGenerationError(
            "DLS-SHARE-INVALID",
            "share roster does not match contacts",
          );
        const index = Number(share.share_index);
        if (!Number.isSafeInteger(index) || index < 1 || shareIndexes.has(index)) {
          throw new ShareGenerationError("DLS-SHARE-INVALID", "share indexes are invalid");
        }
        shareIndexes.add(index);
        bytes(share.death_share_ciphertext, "death share ciphertext", 48);
        bytes(share.recovery_share_ciphertext, "recovery share ciphertext", 48);
      }
      for (let index = 1; index <= contacts.length; index += 1) {
        if (!shareIndexes.has(index))
          throw new ShareGenerationError("DLS-SHARE-INVALID", "share indexes are not sequential");
      }
      const generationCommitment = bytes(
        generation.generation_commitment,
        "generation commitment",
        32,
      );
      if (generationCommitment.every((value) => value === 0)) {
        throw new ShareGenerationError("DLS-SHARE-INVALID", "generation commitment is empty");
      }
      const nowAndId = await getNowAndId(tx, idFactory);
      if (currentGenerationId !== undefined && currentGenerationId !== command.generationId) {
        const previous = await generations.findById(currentGenerationId, { forUpdate: true });
        if (
          previous !== null &&
          previous.status === "ACTIVE" &&
          typeof generations.updateById === "function"
        ) {
          await generations.updateById(currentGenerationId, {
            status: "RETIRED",
            retired_at: nowAndId.now,
          });
        }
      }
      if (typeof generations.updateById !== "function") {
        throw new ShareGenerationError(
          "DLS-SHARE-UNAVAILABLE",
          "generation repository cannot be updated",
          503,
        );
      }
      await generations.updateById(command.generationId, {
        status: "ACTIVE",
        activated_at: nowAndId.now,
      });
      await tx.repositories.vaults.updateVersioned(String(vault.id), Number(vault.version ?? 0), {
        active_share_generation_id: command.generationId,
      });
      const currentRows = (await tx.repositories.contacts.findMany?.()) ?? [];
      for (const row of currentRows) {
        if (contactIds.has(String(row.id)) && row.status !== "ACTIVE") {
          await tx.repositories.contacts.updateVersioned(row.id, Number(row.version ?? 0), {
            status: "ACTIVE",
            active_share_generation_id: command.generationId,
          });
        } else if (contactIds.has(String(row.id))) {
          await tx.repositories.contacts.updateVersioned(row.id, Number(row.version ?? 0), {
            active_share_generation_id: command.generationId,
          });
        }
      }
      await tx.repositories.systemSettings.updateVersioned(true, Number(settings.version ?? 0), {
        contact_set_version: Number(settings.contact_set_version ?? 0) + 1,
      });
      const ownerProfile = await tx.repositories.ownerProfile.findById(true, { forUpdate: true });
      const activePackage = await tx.repositories.packages.findOneBy?.("status", "ACTIVE", {
        forUpdate: true,
      });
      const armed =
        ownerProfile?.irreversibility_accepted_at !== null &&
        ownerProfile?.irreversibility_accepted_at !== undefined &&
        activePackage !== null &&
        activePackage !== undefined;
      if (
        ownerProfile !== null &&
        typeof tx.repositories.ownerProfile.updateVersioned === "function"
      ) {
        await tx.repositories.ownerProfile.updateVersioned(
          true,
          Number(ownerProfile.version ?? 0),
          {
            setup_state: armed ? "ARMED" : "READY",
          },
        );
      }
      await tx.audit.append({
        eventId: nowAndId.id,
        occurredAt: nowAndId.now,
        eventType: "SHARE_GENERATION_ACTIVATED",
        actorType: "OWNER",
        aggregateType: "share_generation",
        aggregateId: command.generationId,
        requestId: command.requestId,
        result: "SUCCESS",
        metadata: { contactCount: contacts.length, systemState: armed ? "ARMED" : "READY" },
      });
      await tx.outbox.enqueue({
        eventType: "SHARE_GENERATION_ACTIVATED",
        aggregateType: "share_generation",
        aggregateId: command.generationId,
        payload: { vaultId: String(generation.vault_id), systemState: armed ? "ARMED" : "READY" },
        idempotencyKey: `share-generation-activated:${command.generationId}`,
        availableAt: nowAndId.now,
      });
      return {
        generationId: command.generationId,
        status: "ACTIVE",
        contactCount: contacts.length,
        deathThreshold: Number(generation.death_threshold),
        recoveryThreshold: Number(generation.recovery_threshold),
        systemState: armed ? "ARMED" : "READY",
      };
    },
    { isolation: "serializable" },
  );
}
