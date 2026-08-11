import type { TransactionManager } from "../ports/transaction-manager.js";
import type { RecoveryCryptography } from "./approve-recovery.js";
import {
  addMinutes,
  digestSecret,
  makeSecret,
  RecoveryError,
  recoveryBytes,
  recoveryRepository,
  recoverySha256,
  sameBytes,
} from "./recovery-common.js";

export type CreateRewrapSessionResult = Readonly<{
  workflowId: string;
  vaultId: string;
  resetSessionToken: string;
  encryptedVaultKey: Uint8Array;
  sealedVaultKeyDigest: Uint8Array;
  expiresAt: string;
}>;

const challengeError = () =>
  new RecoveryError("DLS-RECOVERY-CHALLENGE-INVALID", "recovery challenge cannot continue", 400);

export async function createRewrapSession(
  command: Readonly<{
    token: string;
    emailVerificationCode: string;
    clientEphemeralPublicKey: Uint8Array;
  }>,
  dependencies: Readonly<{
    transaction: TransactionManager;
    tokenPepper: Uint8Array;
    recoveryCryptography: RecoveryCryptography;
    resetSessionTokenFactory?: () => Uint8Array;
  }>,
): Promise<CreateRewrapSessionResult> {
  const clientKey = recoveryBytes(
    command.clientEphemeralPublicKey,
    "client ephemeral public key",
    32,
  );
  const outcome = await dependencies.transaction.run(async (tx) => {
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
      token.purpose !== "ADMIN_PASSWORD_RESET" ||
      token.consumed_at !== null ||
      token.revoked_at !== null ||
      typeof token.expires_at !== "string" ||
      Date.parse(now) >= Date.parse(token.expires_at) ||
      typeof token.subject_id !== "string"
    ) {
      return { error: challengeError() } as const;
    }
    const workflowId = token.subject_id;
    const workflow = await tx.repositories.workflows.findById(workflowId, { forUpdate: true });
    if (
      workflow === null ||
      workflow.kind !== "PASSWORD_RECOVERY" ||
      workflow.state !== "REWRAP_PENDING"
    ) {
      return { error: challengeError() } as const;
    }
    const generation = await recoveryRepository(
      tx.repositories.shareGenerations,
      "share generations",
    ).findById(String(workflow.share_generation_id), { forUpdate: true });
    if (generation === null || typeof generation.vault_id !== "string") {
      return { error: challengeError() } as const;
    }
    const vault = await tx.repositories.vaults.findById(String(generation.vault_id), {
      forUpdate: true,
    });
    if (vault === null) return { error: challengeError() } as const;
    const codes = recoveryRepository(
      tx.repositories.emailVerificationCodes,
      "email verification codes",
    );
    const code = await codes.findOneBy?.("workflow_id", workflowId, { forUpdate: true });
    if (
      code === null ||
      code === undefined ||
      code.consumed_at !== null ||
      code.locked_at !== null ||
      typeof code.expires_at !== "string" ||
      Date.parse(now) >= Date.parse(code.expires_at)
    ) {
      return { error: challengeError() } as const;
    }
    const actualCodeDigest = digestSecret(command.emailVerificationCode, dependencies.tokenPepper);
    const expectedCodeDigest = recoveryBytes(code.code_hmac, "verification code digest", 32);
    if (!sameBytes(actualCodeDigest, expectedCodeDigest)) {
      const attempts = Number(code.attempt_count ?? 0) + 1;
      await codes.updateVersioned(code.id, Number(code.version ?? 0), {
        attempt_count: attempts,
        ...(attempts >= 5 ? { locked_at: now } : {}),
      });
      return { error: challengeError() } as const;
    }
    const session = await recoveryRepository(
      tx.repositories.recoverySecretSessions,
      "recovery secret sessions",
    ).findOneBy?.("workflow_id", workflowId, { forUpdate: true });
    if (
      session === null ||
      session === undefined ||
      session.status !== "ACTIVE" ||
      typeof session.expires_at !== "string" ||
      Date.parse(now) >= Date.parse(session.expires_at)
    ) {
      return { error: challengeError() } as const;
    }
    const vaultKey = await dependencies.recoveryCryptography.openRecoveryVaultKey({ session });
    try {
      const commitment = await dependencies.recoveryCryptography.commitVaultKey(vaultKey);
      const expectedCommitment = recoveryBytes(
        session.vault_key_commitment,
        "vault commitment",
        32,
      );
      if (!sameBytes(commitment, expectedCommitment)) {
        throw new RecoveryError(
          "DLS-RECOVERY-MATERIAL-INVALID",
          "recovery vault key commitment mismatch",
          503,
        );
      }
      const encryptedVaultKey = await dependencies.recoveryCryptography.sealVaultKey({
        workflowId,
        vaultKey,
        clientEphemeralPublicKey: clientKey,
      });
      const sealedVaultKeyDigest = recoverySha256(encryptedVaultKey);
      const resetSessionToken = makeSecret(dependencies.resetSessionTokenFactory);
      const expiresAt = addMinutes(now, 15);
      await recoveryRepository(
        tx.repositories.passwordRewrapSessions,
        "password rewrap sessions",
      ).insert({
        id: crypto.randomUUID(),
        workflow_id: workflowId,
        replacement_owner_envelope: null,
        replacement_envelope_nonce: null,
        replacement_envelope_protocol_version: null,
        reset_token_hash: digestSecret(resetSessionToken, dependencies.tokenPepper),
        token_hmac_key_version: 1,
        client_ephemeral_public_key: clientKey,
        sealed_vault_key_digest: sealedVaultKeyDigest,
        status: "ACTIVE",
        created_at: now,
        updated_at: now,
        expires_at: expiresAt,
        completed_at: null,
      });
      await tokens.updateById?.(token.id, { consumed_at: now });
      await codes.updateVersioned(code.id, Number(code.version ?? 0), { consumed_at: now });
      await tx.audit.append({
        eventId: crypto.randomUUID(),
        occurredAt: now,
        eventType: "PASSWORD_REWRAP_SESSION_CREATED",
        actorType: "OWNER_EMAIL",
        aggregateType: "workflow",
        aggregateId: workflowId,
        result: "SUCCESS",
        metadata: { expiresAt },
      });
      return {
        value: {
          workflowId,
          vaultId: String(vault.id),
          resetSessionToken,
          encryptedVaultKey,
          sealedVaultKeyDigest,
          expiresAt,
        },
      } as const;
    } finally {
      vaultKey.fill(0);
    }
  });
  clientKey.fill(0);
  if ("error" in outcome) throw outcome.error;
  return outcome.value;
}
