import type { AuditWriter } from "../ports/audit.js";
import type { DatabaseClock } from "../ports/database-clock.js";
import type { ObjectStoragePort } from "../ports/object-storage.js";
import type { OutboxWriter } from "../ports/outbox.js";

export type VaultPackageStatus =
  | "UPLOADING"
  | "READY"
  | "ACTIVE"
  | "SUPERSEDED"
  | "FAILED"
  | "ABORTED";

export type EncryptedPackageMetadata = Readonly<{
  vaultId: string;
  shareGenerationId: string;
  cipherAlgorithm: string;
  streamHeader: Uint8Array;
  ciphertextSize: number;
  ciphertextSha256: string;
  dekEnvelope: Uint8Array;
  dekEnvelopeNonce: Uint8Array;
  dekEnvelopeAlgorithm: string;
  dekEnvelopeProtocolVersion: number;
  dekEnvelopeAadHash: Uint8Array;
  manifestCiphertext: Uint8Array;
  manifestNonce: Uint8Array;
  manifestAlgorithm: string;
  manifestAadHash: Uint8Array;
  clientCryptoVersion: string;
}>;

export type VaultPackageRecord = Readonly<
  EncryptedPackageMetadata & {
    id: string;
    versionNo: number;
    version: number;
    status: VaultPackageStatus;
    objectKey: string;
    uploadId: string;
    expiresAt: string;
    uploadedAt?: string;
    readyAt?: string;
    activatedAt?: string;
    supersededAt?: string;
    failureReason?: string;
    storageMetadata?: Readonly<{ bytes: number; sha256: string; etag: string }>;
  }
>;

export type VaultPackageRepository = Readonly<{
  create(record: VaultPackageRecord): Promise<VaultPackageRecord>;
  findById(id: string, options?: { forUpdate?: boolean }): Promise<VaultPackageRecord | null>;
  findActive(
    vaultId: string,
    options?: { forUpdate?: boolean },
  ): Promise<VaultPackageRecord | null>;
  findCurrentShareGenerationId(vaultId: string, options?: { forUpdate?: boolean }): Promise<string>;
  lockVault(vaultId: string): Promise<void>;
  update(
    id: string,
    expectedVersion: number,
    patch: Partial<VaultPackageRecord>,
  ): Promise<VaultPackageRecord>;
  list(vaultId: string): Promise<readonly VaultPackageRecord[]>;
}>;

export type VaultTransactionContext = Readonly<{
  packages: VaultPackageRepository;
  clock: DatabaseClock;
  outbox: OutboxWriter;
  audit: AuditWriter;
}>;

export interface VaultTransactionRunner {
  run<T>(work: (tx: VaultTransactionContext) => Promise<T>): Promise<T>;
}

export interface EncryptedManifestVerifier {
  verify(record: VaultPackageRecord): Promise<void>;
}

export interface OwnerPasswordVerifier {
  verify(password: string): Promise<void>;
}

export type VaultUseCaseDependencies = Readonly<{
  packages: VaultPackageRepository;
  storage: ObjectStoragePort;
  clock: DatabaseClock;
  transaction?: VaultTransactionRunner;
  manifestVerifier?: EncryptedManifestVerifier;
  passwordVerifier?: OwnerPasswordVerifier;
  idFactory: () => string;
  objectKeyFactory: (id: string) => string;
  nextVersionNo: () => Promise<number>;
  maxEncryptedBytes?: number;
}>;

export class VaultUseCaseError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 422) {
    super(message);
    this.name = "VaultUseCaseError";
    this.code = code;
    this.status = status;
  }
}

export const DEFAULT_MAX_ENCRYPTED_BYTES = 5 * 1024 * 1024 * 1024;

export function assertNotExpired(expiresAt: string, now: string): void {
  const expires = Date.parse(expiresAt);
  const current = Date.parse(now);
  if (!Number.isFinite(expires) || !Number.isFinite(current) || expires <= current) {
    throw new VaultUseCaseError("DLS-UPLOAD-EXPIRED", "upload session has expired", 409);
  }
}

export function assertCiphertextSha256(value: string): void {
  if (!/^[0-9a-f]{64}$/u.test(value)) {
    throw new VaultUseCaseError(
      "DLS-PACKAGE-INTEGRITY",
      "ciphertextSha256 must be lowercase SHA-256 hex",
    );
  }
}

export function assertBytes(value: Uint8Array, field: string, allowEmpty = false): void {
  if (!(value instanceof Uint8Array) || (!allowEmpty && value.length === 0)) {
    throw new VaultUseCaseError("DLS-PACKAGE-METADATA", `${field} is required`);
  }
}

export function defaultManifestVerifier(): EncryptedManifestVerifier {
  return {
    async verify(record) {
      if (record.cipherAlgorithm !== "XCHACHA20_POLY1305_SECRETSTREAM_V1") {
        throw new VaultUseCaseError("DLS-PACKAGE-INTEGRITY", "unsupported ciphertext algorithm");
      }
      if (record.streamHeader.length !== 24) {
        throw new VaultUseCaseError("DLS-PACKAGE-INTEGRITY", "invalid secretstream header");
      }
      assertBytes(record.manifestCiphertext, "manifestCiphertext");
      assertBytes(record.manifestNonce, "manifestNonce");
      assertBytes(record.manifestAadHash, "manifestAadHash");
      assertBytes(record.dekEnvelope, "dekEnvelope");
      assertBytes(record.dekEnvelopeNonce, "dekEnvelopeNonce");
      assertBytes(record.dekEnvelopeAadHash, "dekEnvelopeAadHash");
    },
  };
}
