import { beijingDateAt, computeCheckinDeadline } from "@dls/domain";
import type { SessionService } from "../auth/session-service.js";
import { OWNER_ACTOR_ID } from "../owner/owner-identity.js";
import type { TransactionManager } from "../ports/transaction-manager.js";
import type { OwnerVaultEnvelope } from "../setup/create-owner.js";
import type { RecoveryCryptography } from "./approve-recovery.js";
import {
  destroyRecoveryArtifacts,
  digestSecret,
  RecoveryError,
  recoveryBytes,
  recoveryInteger,
  recoveryRepository,
  sameBytes,
} from "./recovery-common.js";

export type CompletePasswordResetCommand = Readonly<{
  resetSessionToken: string;
  newPassword: string;
  newOwnerVaultEnvelope: OwnerVaultEnvelope;
  vaultKeyProof: string;
  requestId: string;
}>;

export type CompletePasswordResetResult = Readonly<{
  completed: true;
  workflowState: "COMPLETED";
  credentialVersion: number;
  nextDeadlineAt: string;
}>;

function decode(value: string, name: string, minimum: number): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new RecoveryError("DLS-RECOVERY-REPLACEMENT-INVALID", `${name} is invalid`, 400);
  }
  const decoded = new Uint8Array(Buffer.from(value, "base64url"));
  if (decoded.length < minimum) {
    throw new RecoveryError("DLS-RECOVERY-REPLACEMENT-INVALID", `${name} is invalid`, 400);
  }
  return decoded;
}

function validate(command: CompletePasswordResetCommand): void {
  const password = new TextEncoder().encode(command.newPassword.normalize("NFC"));
  if (password.length < 12 || password.length > 512) {
    throw new RecoveryError("DLS-RECOVERY-PASSWORD-INVALID", "new password is invalid", 400);
  }
  const envelope = command.newOwnerVaultEnvelope;
  if (!/^[0-9a-f]{64}$/u.test(envelope.vkCommitment)) {
    throw new RecoveryError("DLS-RECOVERY-REPLACEMENT-INVALID", "VK commitment is invalid", 400);
  }
  if (
    envelope.kdfParams.algorithm !== "argon2id" ||
    envelope.kdfParams.memoryKiB !== 65_536 ||
    envelope.kdfParams.iterations !== 3 ||
    envelope.kdfParams.parallelism !== 1 ||
    envelope.kdfParams.version !== 19 ||
    envelope.kdfParams.purpose !== "owner-vault-kek-v1"
  ) {
    throw new RecoveryError("DLS-RECOVERY-REPLACEMENT-INVALID", "owner KDF is invalid", 400);
  }
  decode(envelope.ciphertext, "owner envelope", 17);
  decode(envelope.nonce, "owner envelope nonce", 24);
  decode(envelope.kdfSalt, "owner KDF salt", 16);
  decode(envelope.keyVerifierCiphertext, "key verifier", 17);
  decode(envelope.keyVerifierNonce, "key verifier nonce", 24);
  decode(envelope.ownerEnvelopeProof, "owner envelope proof", 16);
  decode(command.vaultKeyProof, "vault key proof", 16);
}

export async function completePasswordReset(
  command: CompletePasswordResetCommand,
  dependencies: Readonly<{
    transaction: TransactionManager;
    sessionService: SessionService;
    tokenPepper: Uint8Array;
    recoveryCryptography: RecoveryCryptography;
    passwordHasher: (password: string) => Promise<string>;
    replacementVerifier: (
      input: Readonly<{
        workflowId: string;
        vaultId: string;
        vaultKey: Uint8Array;
        sealedVaultKeyDigest: Uint8Array;
        newPassword: string;
        envelope: OwnerVaultEnvelope;
        vaultKeyProof: string;
      }>,
    ) => Promise<boolean>;
  }>,
): Promise<CompletePasswordResetResult> {
  validate(command);
  const result = await dependencies.transaction.run<CompletePasswordResetResult>(async (tx) => {
    const rewraps = recoveryRepository(
      tx.repositories.passwordRewrapSessions,
      "password rewrap sessions",
    );
    const candidate = await rewraps.findOneBy?.(
      "reset_token_hash",
      digestSecret(command.resetSessionToken, dependencies.tokenPepper),
    );
    const now = await tx.clock.now();
    if (
      candidate === null ||
      candidate === undefined ||
      typeof candidate.workflow_id !== "string"
    ) {
      throw new RecoveryError(
        "DLS-RECOVERY-SESSION-INVALID",
        "password rewrap session is invalid",
        400,
      );
    }
    const workflowId = candidate.workflow_id;
    const schedule =
      (await tx.repositories.checkinSchedules.findOneBy?.("status", "ACTIVE", {
        forUpdate: true,
      })) ?? (await tx.repositories.checkinSchedules.findFirst?.({ forUpdate: true }));
    if (schedule === null || schedule === undefined) {
      throw new RecoveryError("DLS-RECOVERY-UNAVAILABLE", "check-in schedule is unavailable", 503);
    }
    const workflow = await tx.repositories.workflows.findById(workflowId, { forUpdate: true });
    const recoverySession = await recoveryRepository(
      tx.repositories.recoverySecretSessions,
      "recovery secret sessions",
    ).findOneBy?.("workflow_id", workflowId, { forUpdate: true });
    if (
      workflow === null ||
      workflow.kind !== "PASSWORD_RECOVERY" ||
      workflow.state !== "REWRAP_PENDING" ||
      recoverySession === null ||
      recoverySession === undefined ||
      recoverySession.status !== "ACTIVE"
    ) {
      throw new RecoveryError(
        "DLS-RECOVERY-SESSION-INVALID",
        "password rewrap session is invalid",
        400,
      );
    }
    const rewrap = await rewraps.findById(candidate.id, { forUpdate: true });
    if (
      rewrap === null ||
      rewrap.status !== "ACTIVE" ||
      rewrap.completed_at !== null ||
      typeof rewrap.expires_at !== "string" ||
      Date.parse(now) >= Date.parse(rewrap.expires_at) ||
      String(rewrap.workflow_id) !== workflowId
    ) {
      throw new RecoveryError(
        "DLS-RECOVERY-SESSION-INVALID",
        "password rewrap session is invalid",
        400,
      );
    }
    const generation = await recoveryRepository(
      tx.repositories.shareGenerations,
      "share generations",
    ).findById(String(workflow.share_generation_id), { forUpdate: true });
    if (generation === null) {
      throw new RecoveryError("DLS-RECOVERY-SESSION-INVALID", "generation is unavailable", 503);
    }
    const vault = await tx.repositories.vaults.findById(String(generation.vault_id), {
      forUpdate: true,
    });
    if (vault === null) {
      throw new RecoveryError("DLS-RECOVERY-SESSION-INVALID", "vault is unavailable", 503);
    }
    const vaultKey = await dependencies.recoveryCryptography.openRecoveryVaultKey({
      session: recoverySession,
    });
    try {
      const actualCommitment = await dependencies.recoveryCryptography.commitVaultKey(vaultKey);
      const expectedCommitment = recoveryBytes(vault.vk_commitment, "vault commitment", 32);
      if (
        !sameBytes(actualCommitment, expectedCommitment) ||
        command.newOwnerVaultEnvelope.vkCommitment !==
          Buffer.from(expectedCommitment).toString("hex") ||
        !(await dependencies.replacementVerifier({
          workflowId,
          vaultId: String(vault.id),
          vaultKey,
          sealedVaultKeyDigest: recoveryBytes(
            rewrap.sealed_vault_key_digest,
            "sealed vault key digest",
            32,
          ),
          newPassword: command.newPassword,
          envelope: command.newOwnerVaultEnvelope,
          vaultKeyProof: command.vaultKeyProof,
        }))
      ) {
        throw new RecoveryError(
          "DLS-RECOVERY-REPLACEMENT-INVALID",
          "replacement owner envelope failed verification",
          400,
        );
      }
      const credentials = await tx.repositories.ownerCredentials.findById(true, {
        forUpdate: true,
      });
      if (credentials === null) {
        throw new RecoveryError(
          "DLS-RECOVERY-SESSION-INVALID",
          "owner credentials are unavailable",
          503,
        );
      }
      const passwordHash = await dependencies.passwordHasher(command.newPassword);
      const credentialVersion = Number(credentials.version ?? 0) + 1;
      await tx.repositories.ownerCredentials.updateVersioned(
        true,
        Number(credentials.version ?? 0),
        {
          password_phc: passwordHash,
          password_changed_at: now,
          password_pepper_version: 1,
          password_kdf_version: 1,
          password_normalization_version: 1,
        },
      );
      const envelope = command.newOwnerVaultEnvelope;
      await tx.repositories.vaults.updateVersioned(vault.id, Number(vault.version ?? 0), {
        owner_vault_envelope: decode(envelope.ciphertext, "owner envelope", 17),
        owner_envelope_nonce: decode(envelope.nonce, "owner envelope nonce", 24),
        owner_envelope_algorithm: "XCHACHA20_POLY1305",
        owner_envelope_protocol_version: 1,
        owner_envelope_aad_hash:
          envelope.aadHash === undefined
            ? new Uint8Array(32)
            : decode(envelope.aadHash, "owner envelope AAD hash", 16),
        owner_kdf_salt: decode(envelope.kdfSalt, "owner KDF salt", 16),
        owner_kdf_params: envelope.kdfParams,
        key_verifier_ciphertext: decode(envelope.keyVerifierCiphertext, "key verifier", 17),
        key_verifier_nonce: decode(envelope.keyVerifierNonce, "key verifier nonce", 24),
      });
      await rewraps.updateVersioned(rewrap.id, Number(rewrap.version ?? 0), {
        status: "CONSUMED",
        completed_at: now,
      });
      const sessions = tx.repositories.authSessions;
      for (const session of (await sessions?.findMany?.("actor_type", "OWNER", {
        forUpdate: true,
      })) ?? []) {
        if (session.revoked_at === null && sessions?.updateById !== undefined) {
          await sessions.updateById(session.id, { revoked_at: now });
        }
      }
      await destroyRecoveryArtifacts(tx, workflowId, now);
      await tx.repositories.workflows.updateVersioned(workflowId, Number(workflow.version ?? 0), {
        state: "COMPLETED",
        ended_at: now,
        end_reason: "PASSWORD_RESET_COMPLETED",
      });

      const day = beijingDateAt(now);
      const existing = await tx.repositories.checkIns.findOneBy?.("beijing_date", day, {
        forUpdate: true,
      });
      const nextDeadlineAt = computeCheckinDeadline(
        now,
        recoveryInteger(schedule.threshold_days, "check-in threshold"),
      );
      if (existing === null || existing === undefined) {
        const checkInId = crypto.randomUUID();
        await tx.repositories.checkIns.insert({
          id: checkInId,
          beijing_date: day,
          checked_in_at: now,
          source: "PASSWORD_RECOVERY",
          actor_type: "OWNER",
          actor_ref: OWNER_ACTOR_ID,
          workflow_id: workflowId,
          request_id: command.requestId,
        });
        await tx.repositories.checkinSchedules.updateVersioned(
          schedule.id,
          Number(schedule.version ?? 0),
          {
            last_check_in_id: checkInId,
            schedule_version: Number(schedule.schedule_version ?? 0) + 1,
            deadline_at: nextDeadlineAt,
            status: "ACTIVE",
          },
        );
      }
      await tx.audit.append({
        eventId: crypto.randomUUID(),
        occurredAt: now,
        eventType: "PASSWORD_RECOVERY_COMPLETED",
        actorType: "OWNER",
        aggregateType: "workflow",
        aggregateId: workflowId,
        requestId: command.requestId,
        result: "SUCCESS",
        metadata: { credentialVersion },
      });
      return {
        completed: true,
        workflowState: "COMPLETED",
        credentialVersion,
        nextDeadlineAt,
      };
    } finally {
      vaultKey.fill(0);
    }
  });
  await dependencies.sessionService.revokeAll("OWNER", OWNER_ACTOR_ID);
  return result;
}
