import { randomUUID, timingSafeEqual } from "node:crypto";
import type { IssuedSession } from "../auth/session.js";
import type { SessionService } from "../auth/session-service.js";
import type { TransactionManager } from "../ports/transaction-manager.js";
import type { OwnerVaultEnvelope } from "../setup/create-owner.js";
import type { OwnerServerPasswordVerifier } from "./login-owner.js";

export type ChangeOwnerPasswordCommand = Readonly<{
  ownerId: string;
  oldPassword: string;
  newPassword: string;
  newOwnerVaultEnvelope: OwnerVaultEnvelope;
  vaultKeyProof?: string;
  requestId: string;
}>;

export type ChangeOwnerPasswordResult = Readonly<{
  session: IssuedSession;
  credentialVersion: number;
}>;

export class OwnerPasswordChangeError extends Error {
  public constructor(
    public readonly code:
      | "OWNER_REAUTH_REQUIRED"
      | "OWNER_PASSWORD_INVALID"
      | "OWNER_VAULT_INVALID",
    message: string,
    public readonly status = code === "OWNER_REAUTH_REQUIRED" ? 401 : 400,
  ) {
    super(message);
    this.name = "OwnerPasswordChangeError";
  }
}

function decode(value: string, name: string, minimumBytes: number): Buffer {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new OwnerPasswordChangeError("OWNER_VAULT_INVALID", `${name} is invalid`);
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length < minimumBytes) {
    throw new OwnerPasswordChangeError("OWNER_VAULT_INVALID", `${name} is invalid`);
  }
  return decoded;
}

function validatePassword(password: string): void {
  const bytes = new TextEncoder().encode(password.normalize("NFC"));
  if (bytes.length < 12 || bytes.length > 512) {
    throw new OwnerPasswordChangeError("OWNER_PASSWORD_INVALID", "new password is invalid");
  }
}

function validateEnvelope(envelope: OwnerVaultEnvelope): void {
  if (!/^[0-9a-f]{64}$/u.test(envelope.vkCommitment)) {
    throw new OwnerPasswordChangeError("OWNER_VAULT_INVALID", "vk commitment is invalid");
  }
  if (
    envelope.kdfParams.algorithm !== "argon2id" ||
    envelope.kdfParams.memoryKiB !== 65_536 ||
    envelope.kdfParams.iterations !== 3 ||
    envelope.kdfParams.parallelism !== 1 ||
    envelope.kdfParams.version !== 19 ||
    envelope.kdfParams.purpose !== "owner-vault-kek-v1"
  ) {
    throw new OwnerPasswordChangeError("OWNER_VAULT_INVALID", "owner KDF profile is invalid");
  }
  decode(envelope.ciphertext, "owner envelope", 2);
  decode(envelope.nonce, "owner envelope nonce", 8);
  decode(envelope.kdfSalt, "owner KDF salt", 8);
  decode(envelope.keyVerifierCiphertext, "key verifier", 2);
  decode(envelope.keyVerifierNonce, "key verifier nonce", 8);
  decode(envelope.ownerEnvelopeProof, "owner envelope proof", 2);
  if (envelope.aadHash !== undefined) decode(envelope.aadHash, "owner envelope AAD hash", 16);
}

function sameBytes(left: unknown, right: Uint8Array): boolean {
  if (!(left instanceof Uint8Array)) return false;
  const actual = Buffer.from(left);
  return actual.length === right.length && timingSafeEqual(actual, Buffer.from(right));
}

export async function changeOwnerPassword(
  command: ChangeOwnerPasswordCommand,
  dependencies: Readonly<{
    transaction: TransactionManager;
    sessionService: SessionService;
    passwordVerifier: OwnerServerPasswordVerifier;
    passwordHasher: (password: string) => Promise<string>;
    idFactory?: () => string;
  }>,
): Promise<ChangeOwnerPasswordResult> {
  validatePassword(command.newPassword);
  validateEnvelope(command.newOwnerVaultEnvelope);
  const result = await dependencies.transaction.run(
    async (tx) => {
      const credentials = await tx.repositories.ownerCredentials.findById(true, {
        forUpdate: true,
      });
      if (
        credentials === null ||
        typeof credentials.password_phc !== "string" ||
        !(await dependencies.passwordVerifier(command.oldPassword, credentials.password_phc))
      ) {
        throw new OwnerPasswordChangeError(
          "OWNER_REAUTH_REQUIRED",
          "owner reauthentication is required",
        );
      }
      const vault = await tx.repositories.vaults.findFirst?.({ forUpdate: true });
      if (
        vault === null ||
        vault === undefined ||
        !sameBytes(
          vault.vk_commitment,
          Buffer.from(command.newOwnerVaultEnvelope.vkCommitment, "hex"),
        )
      ) {
        throw new OwnerPasswordChangeError(
          "OWNER_VAULT_INVALID",
          "owner vault commitment does not match",
        );
      }
      const now = await tx.clock.now();
      const previousVersion = Number(credentials.version ?? credentials.credential_version ?? 0);
      const credentialVersion = previousVersion + 1;
      const passwordHash = await dependencies.passwordHasher(command.newPassword);
      await tx.repositories.ownerCredentials.updateVersioned(true, previousVersion, {
        password_phc: passwordHash,
        password_changed_at: now,
        password_pepper_version: 1,
        password_kdf_version: 1,
        password_normalization_version: 1,
        credential_version: credentialVersion,
      });
      const envelope = command.newOwnerVaultEnvelope;
      await tx.repositories.vaults.updateVersioned(vault.id, Number(vault.version ?? 0), {
        owner_vault_envelope: Buffer.from(decode(envelope.ciphertext, "owner envelope", 2)),
        owner_envelope_nonce: Buffer.from(decode(envelope.nonce, "owner envelope nonce", 8)),
        owner_envelope_aad_hash: Buffer.from(
          envelope.aadHash === undefined
            ? new Uint8Array(32)
            : decode(envelope.aadHash, "owner envelope AAD hash", 16),
        ),
        owner_kdf_salt: Buffer.from(decode(envelope.kdfSalt, "owner KDF salt", 8)),
        owner_kdf_params: envelope.kdfParams,
        key_verifier_ciphertext: Buffer.from(
          decode(envelope.keyVerifierCiphertext, "key verifier", 2),
        ),
        key_verifier_nonce: Buffer.from(decode(envelope.keyVerifierNonce, "key verifier nonce", 8)),
      });
      await tx.audit.append({
        eventId: dependencies.idFactory?.() ?? randomUUID(),
        occurredAt: now,
        eventType: "OWNER_PASSWORD_CHANGED",
        actorType: "OWNER",
        aggregateType: "owner",
        aggregateId: command.ownerId,
        requestId: command.requestId,
        result: "SUCCESS",
        metadata: { credentialVersion },
      });
      await tx.outbox.enqueue({
        eventType: "OWNER_PASSWORD_CHANGED",
        aggregateType: "owner",
        aggregateId: command.ownerId,
        payload: { credentialVersion },
        idempotencyKey: `owner-password-change:${command.requestId}`,
        availableAt: now,
      });
      return { credentialVersion };
    },
    { isolation: "serializable" },
  );
  await dependencies.sessionService.revokeAll("OWNER", command.ownerId);
  const session = await dependencies.sessionService.create({
    actorType: "OWNER",
    actorId: command.ownerId,
    credentialVersion: result.credentialVersion,
  });
  return { ...result, session };
}
