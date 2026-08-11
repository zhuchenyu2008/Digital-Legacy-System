import { randomUUID, timingSafeEqual } from "node:crypto";
import { computeCheckinDeadline } from "@dls/domain";
import type { IssuedSession } from "../auth/session.js";
import type { SessionService } from "../auth/session-service.js";
import { OWNER_ACTOR_ID } from "../owner/owner-identity.js";
import type { TransactionManager } from "../ports/transaction-manager.js";
import type { FieldProtector } from "./field-protector.js";

export type OwnerVaultEnvelope = Readonly<{
  ciphertext: string;
  nonce: string;
  kdfSalt: string;
  kdfParams: Readonly<{
    algorithm: "argon2id";
    memoryKiB: number;
    iterations: number;
    parallelism: number;
    version: number;
    purpose: "owner-vault-kek-v1";
  }>;
  keyVerifierCiphertext: string;
  keyVerifierNonce: string;
  vkCommitment: string;
  ownerEnvelopeProof: string;
  aadHash?: string;
}>;

export type OwnerSetupCommand = Readonly<{
  setupToken: string;
  vaultId: string;
  displayName: string;
  primaryEmail: string;
  backupEmail?: string;
  password: string;
  ownerVaultEnvelope: OwnerVaultEnvelope;
  requestId: string;
}>;

export type OwnerSetupDependencies = Readonly<{
  transaction: TransactionManager;
  expectedSetupToken: string;
  passwordHasher: (password: string) => Promise<string>;
  protector: FieldProtector;
  sessionService?: SessionService;
  idFactory?: () => string;
  consentVersion?: string;
  consentDocumentSha256?: Uint8Array;
  publicBaseUrl?: string;
  smtpConfigured?: boolean;
}>;

export type OwnerSetupResult = Readonly<{
  ownerId: string;
  vaultId: string;
  session?: IssuedSession;
}>;

export class OwnerSetupError extends Error {
  public constructor(
    public readonly code: "SETUP_INVALID" | "SETUP_ALREADY_COMPLETE",
    message: string,
  ) {
    super(message);
    this.name = "OwnerSetupError";
  }
}

function setupError(message: string): never {
  throw new OwnerSetupError("SETUP_INVALID", message);
}

function decodeBase64Url(value: string, name: string, minimumBytes = 1): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) setupError(`${name} is invalid`);
  const decoded = Uint8Array.from(Buffer.from(value, "base64url"));
  if (decoded.length < minimumBytes) setupError(`${name} is invalid`);
  return decoded;
}

function equalSecret(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function normalizeEmail(value: string, name: string): string {
  const email = value.normalize("NFC").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320)
    setupError(`${name} is invalid`);
  return email;
}

function validateCommand(command: OwnerSetupCommand, expectedSetupToken: string): void {
  if (!equalSecret(command.setupToken, expectedSetupToken))
    setupError("setup capability is invalid");
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(command.vaultId)
  )
    setupError("vault id is invalid");
  if (command.displayName.normalize("NFC").trim().length === 0 || command.displayName.length > 120)
    setupError("display name is invalid");
  const primaryEmail = normalizeEmail(command.primaryEmail, "primary email");
  if (
    command.backupEmail !== undefined &&
    normalizeEmail(command.backupEmail, "backup email") === primaryEmail
  )
    setupError("backup email must differ from primary email");
  const passwordBytes = new TextEncoder().encode(command.password.normalize("NFC"));
  if (passwordBytes.length < 12 || passwordBytes.length > 512) setupError("password is invalid");
  if (!/^[0-9a-f]{64}$/.test(command.ownerVaultEnvelope.vkCommitment))
    setupError("vk commitment is invalid");
  const { kdfParams } = command.ownerVaultEnvelope;
  if (
    kdfParams.algorithm !== "argon2id" ||
    kdfParams.memoryKiB !== 65_536 ||
    kdfParams.iterations !== 3 ||
    kdfParams.parallelism !== 1 ||
    kdfParams.version !== 19 ||
    kdfParams.purpose !== "owner-vault-kek-v1"
  )
    setupError("owner KDF profile is invalid");
  decodeBase64Url(command.ownerVaultEnvelope.ciphertext, "owner envelope", 2);
  decodeBase64Url(command.ownerVaultEnvelope.nonce, "owner envelope nonce", 8);
  decodeBase64Url(command.ownerVaultEnvelope.kdfSalt, "owner KDF salt", 8);
  decodeBase64Url(command.ownerVaultEnvelope.keyVerifierCiphertext, "key verifier", 2);
  decodeBase64Url(command.ownerVaultEnvelope.keyVerifierNonce, "key verifier nonce", 8);
  decodeBase64Url(command.ownerVaultEnvelope.ownerEnvelopeProof, "owner envelope proof", 2);
  if (command.ownerVaultEnvelope.aadHash !== undefined)
    decodeBase64Url(command.ownerVaultEnvelope.aadHash, "owner envelope AAD hash", 16);
}

function beijingDate(instant: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(instant));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export async function createOwner(
  command: OwnerSetupCommand,
  dependencies: OwnerSetupDependencies,
): Promise<OwnerSetupResult> {
  validateCommand(command, dependencies.expectedSetupToken);
  const idFactory = dependencies.idFactory ?? randomUUID;
  const ownerId = OWNER_ACTOR_ID;
  const vaultId = command.vaultId;
  return dependencies.transaction.run(
    async (tx) => {
      if ((await tx.repositories.ownerProfile.findById(true, { forUpdate: true })) !== null) {
        throw new OwnerSetupError("SETUP_ALREADY_COMPLETE", "owner setup is already complete");
      }
      const now = await tx.clock.now();
      const primaryEmail = normalizeEmail(command.primaryEmail, "primary email");
      const backupEmail =
        command.backupEmail === undefined
          ? undefined
          : normalizeEmail(command.backupEmail, "backup email");
      const displayName = command.displayName.normalize("NFC").trim();
      const protectedDisplayName = await dependencies.protector.protect(
        displayName,
        "owner-display-name",
      );
      const protectedPrimaryEmail = await dependencies.protector.protect(
        primaryEmail,
        "owner-primary-email",
      );
      const protectedBackupEmail =
        backupEmail === undefined
          ? undefined
          : await dependencies.protector.protect(backupEmail, "owner-backup-email");
      const passwordHash = await dependencies.passwordHasher(command.password);
      const envelope = command.ownerVaultEnvelope;
      const envelopeAadHash =
        envelope.aadHash === undefined
          ? new Uint8Array(32)
          : decodeBase64Url(envelope.aadHash, "owner envelope AAD hash", 16);
      const checkInId = idFactory();
      const scheduleId = idFactory();
      const deadlineAt = computeCheckinDeadline(now, 3);
      const consentDocumentSha256 = dependencies.consentDocumentSha256 ?? new Uint8Array(32);

      await tx.repositories.ownerProfile.insert({
        singleton_id: true,
        display_name_ciphertext: Buffer.from(protectedDisplayName.ciphertext),
        display_name_nonce: Buffer.from(protectedDisplayName.nonce),
        display_name_key_version: protectedDisplayName.keyVersion,
        primary_email_ciphertext: Buffer.from(protectedPrimaryEmail.ciphertext),
        primary_email_nonce: Buffer.from(protectedPrimaryEmail.nonce),
        primary_email_key_version: protectedPrimaryEmail.keyVersion,
        primary_email_lookup_hmac: Buffer.from(protectedPrimaryEmail.lookupHmac),
        ...(protectedBackupEmail === undefined
          ? {}
          : {
              backup_email_ciphertext: Buffer.from(protectedBackupEmail.ciphertext),
              backup_email_nonce: Buffer.from(protectedBackupEmail.nonce),
              backup_email_key_version: protectedBackupEmail.keyVersion,
              backup_email_lookup_hmac: Buffer.from(protectedBackupEmail.lookupHmac),
            }),
        setup_state: "READY",
      });
      await tx.repositories.ownerCredentials.insert({
        singleton_id: true,
        password_phc: passwordHash,
        password_changed_at: now,
        password_pepper_version: 1,
        password_kdf_version: 1,
        password_normalization_version: 1,
      });
      await tx.repositories.systemSettings.insert({
        singleton_id: true,
        timezone: "Asia/Shanghai",
        missed_days_threshold: 3,
        contact_consent_version: dependencies.consentVersion ?? "2026-08-01",
        contact_consent_sha256: Buffer.from(consentDocumentSha256),
        public_base_url: dependencies.publicBaseUrl ?? "http://localhost:3000",
        smtp_configured: dependencies.smtpConfigured === true,
      });
      await tx.repositories.vaults.insert({
        id: vaultId,
        owner_vault_envelope: Buffer.from(decodeBase64Url(envelope.ciphertext, "owner envelope")),
        owner_envelope_nonce: Buffer.from(decodeBase64Url(envelope.nonce, "owner envelope nonce")),
        owner_envelope_algorithm: "XCHACHA20_POLY1305",
        owner_envelope_protocol_version: 1,
        owner_envelope_aad_hash: Buffer.from(envelopeAadHash),
        owner_kdf_salt: Buffer.from(decodeBase64Url(envelope.kdfSalt, "owner KDF salt")),
        owner_kdf_params: envelope.kdfParams,
        vk_commitment: Buffer.from(envelope.vkCommitment, "hex"),
        key_verifier_ciphertext: Buffer.from(
          decodeBase64Url(envelope.keyVerifierCiphertext, "key verifier"),
        ),
        key_verifier_nonce: Buffer.from(
          decodeBase64Url(envelope.keyVerifierNonce, "key verifier nonce"),
        ),
      });
      await tx.repositories.checkIns.insert({
        id: checkInId,
        beijing_date: beijingDate(now),
        checked_in_at: now,
        source: "SETUP",
        actor_type: "OWNER",
        actor_ref: ownerId,
        request_id: command.requestId,
      });
      await tx.repositories.checkinSchedules.insert({
        id: scheduleId,
        schedule_version: 1,
        last_check_in_id: checkInId,
        threshold_days: 3,
        deadline_at: deadlineAt,
        status: "ACTIVE",
      });
      await tx.audit.append({
        eventId: idFactory(),
        occurredAt: now,
        eventType: "OWNER_SETUP_COMPLETED",
        actorType: "OWNER",
        aggregateType: "owner",
        aggregateId: ownerId,
        requestId: command.requestId,
        result: "SUCCESS",
        metadata: { vaultId },
      });
      await tx.outbox.enqueue({
        eventType: "OWNER_SETUP_COMPLETED",
        aggregateType: "owner",
        aggregateId: ownerId,
        payload: { vaultId },
        idempotencyKey: `owner-setup:${ownerId}`,
        availableAt: now,
      });
      await tx.outbox.enqueue({
        eventType: "CHECKIN_EVALUATE_REQUESTED",
        aggregateType: "checkin_schedule",
        aggregateId: scheduleId,
        payload: { aggregateId: scheduleId, aggregateVersion: 1 },
        idempotencyKey: `checkin-evaluate:${scheduleId}:1`,
        availableAt: deadlineAt,
      });
      const session =
        dependencies.sessionService === undefined
          ? undefined
          : await dependencies.sessionService.create({
              actorType: "OWNER",
              actorId: ownerId,
              credentialVersion: 0,
            });
      return { ownerId, vaultId, ...(session === undefined ? {} : { session }) };
    },
    { isolation: "serializable" },
  );
}
