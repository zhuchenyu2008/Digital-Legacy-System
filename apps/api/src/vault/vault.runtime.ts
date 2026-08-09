import { randomUUID } from "node:crypto";
import {
  AbortUpload,
  ActivatePackage,
  type ActivatePackageInput,
  CompleteUpload,
  type CompleteUploadInput,
  CreateUploadSession,
  type CreateUploadSessionInput,
  type RepositoryRow,
  StreamUpload,
  type StreamUploadInput,
  type TransactionContext,
  type TransactionManager,
  type UploadSession,
  type VaultPackageRecord,
  type VaultPackageRepository,
  type VaultTransactionContext,
  type VaultTransactionRunner,
  VaultUseCaseError,
} from "@dls/application";
import { verifyServerPassword } from "@dls/crypto/node";
import { createPgPool, PgTransactionManager } from "@dls/persistence";
import { buildObjectKey, createStorage } from "@dls/storage";
import { getApiRuntimeConfig } from "../config/api-runtime-config.js";
import { getPublicRuntimeConfig } from "../config/public-runtime-config.js";

export const VAULT_RUNTIME = Symbol("VAULT_RUNTIME");

export type VaultRequestContext = Readonly<{
  ownerId: string;
  csrfToken: string;
  idempotencyKey: string;
  requestId?: string;
}>;

export interface VaultRuntime {
  createUploadSession(
    input: CreateUploadSessionInput,
    context: VaultRequestContext,
  ): Promise<UploadSession>;
  streamUpload(input: StreamUploadInput, context: VaultRequestContext): Promise<VaultPackageRecord>;
  completeUpload(
    input: CompleteUploadInput,
    context: VaultRequestContext,
  ): Promise<VaultPackageRecord>;
  activatePackage(
    input: ActivatePackageInput,
    context: VaultRequestContext,
  ): Promise<VaultPackageRecord>;
  listPackages(context: VaultRequestContext): Promise<readonly VaultPackageRecord[]>;
  abortUpload(
    input: Readonly<{ packageId: string; uploadId: string }>,
    context: VaultRequestContext,
  ): Promise<VaultPackageRecord>;
}

function bytes(value: unknown, field: string): Uint8Array {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  throw new VaultUseCaseError("DLS-PACKAGE-STORAGE", `${field} is invalid`, 500);
}

function text(value: unknown, field: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  throw new VaultUseCaseError("DLS-PACKAGE-STORAGE", `${field} is invalid`, 500);
}

function optionalText(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : String(value);
}

function storageMetadata(value: unknown): VaultPackageRecord["storageMetadata"] {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new VaultUseCaseError("DLS-PACKAGE-STORAGE", "storage metadata is invalid", 500);
  }
  const record = value as Record<string, unknown>;
  const metadata = {
    bytes: Number(record.bytes),
    sha256: String(record.sha256),
    etag: String(record.etag),
  };
  if (
    !Number.isSafeInteger(metadata.bytes) ||
    metadata.bytes < 0 ||
    !/^[0-9a-f]{64}$/u.test(metadata.sha256) ||
    metadata.etag.length === 0
  ) {
    throw new VaultUseCaseError("DLS-PACKAGE-STORAGE", "storage metadata is invalid", 500);
  }
  return metadata;
}

function packageRecord(row: RepositoryRow): VaultPackageRecord {
  const metadata = storageMetadata(row.storage_metadata);
  const failureReason = optionalText(row.failure_reason);
  const uploadedAt = optionalText(row.uploaded_at);
  const readyAt = optionalText(row.ready_at);
  const activatedAt = optionalText(row.activated_at);
  const supersededAt = optionalText(row.superseded_at);
  return {
    id: text(row.id, "package id"),
    vaultId: text(row.vault_id, "vault id"),
    shareGenerationId: text(row.share_generation_id, "share generation id"),
    versionNo: Number(row.version_no),
    version: Number(row.version),
    status: text(row.status, "package status") as VaultPackageRecord["status"],
    objectKey: text(row.object_key, "object key"),
    uploadId: text(row.upload_id, "upload id"),
    cipherAlgorithm: text(row.cipher_algorithm, "cipher algorithm"),
    streamHeader: bytes(row.stream_header, "stream header"),
    ciphertextSize: Number(row.ciphertext_size),
    ciphertextSha256: Buffer.from(bytes(row.ciphertext_sha256, "ciphertext digest")).toString(
      "hex",
    ),
    dekEnvelope: bytes(row.dek_envelope, "DEK envelope"),
    dekEnvelopeNonce: bytes(row.dek_envelope_nonce, "DEK envelope nonce"),
    dekEnvelopeAlgorithm: text(row.dek_envelope_algorithm, "DEK envelope algorithm"),
    dekEnvelopeProtocolVersion: Number(row.dek_envelope_protocol_version),
    dekEnvelopeAadHash: bytes(row.dek_envelope_aad_hash, "DEK envelope AAD hash"),
    manifestCiphertext: bytes(row.manifest_ciphertext, "manifest ciphertext"),
    manifestNonce: bytes(row.manifest_nonce, "manifest nonce"),
    manifestAlgorithm: text(row.manifest_algorithm, "manifest algorithm"),
    manifestAadHash: bytes(row.manifest_aad_hash, "manifest AAD hash"),
    clientCryptoVersion: text(row.client_crypto_version, "client crypto version"),
    expiresAt: text(row.expires_at, "upload expiry"),
    ...(failureReason === undefined ? {} : { failureReason }),
    ...(uploadedAt === undefined ? {} : { uploadedAt }),
    ...(readyAt === undefined ? {} : { readyAt }),
    ...(activatedAt === undefined ? {} : { activatedAt }),
    ...(supersededAt === undefined ? {} : { supersededAt }),
    ...(metadata === undefined ? {} : { storageMetadata: metadata }),
  };
}

function packageRow(record: VaultPackageRecord): Record<string, unknown> {
  return {
    id: record.id,
    vault_id: record.vaultId,
    share_generation_id: record.shareGenerationId,
    version_no: record.versionNo,
    version: record.version,
    status: record.status,
    object_key: record.objectKey,
    upload_id: record.uploadId,
    cipher_algorithm: record.cipherAlgorithm,
    stream_header: Buffer.from(record.streamHeader),
    ciphertext_size: record.ciphertextSize,
    ciphertext_sha256: Buffer.from(record.ciphertextSha256, "hex"),
    dek_envelope: Buffer.from(record.dekEnvelope),
    dek_envelope_nonce: Buffer.from(record.dekEnvelopeNonce),
    dek_envelope_algorithm: record.dekEnvelopeAlgorithm,
    dek_envelope_protocol_version: record.dekEnvelopeProtocolVersion,
    dek_envelope_aad_hash: Buffer.from(record.dekEnvelopeAadHash),
    manifest_ciphertext: Buffer.from(record.manifestCiphertext),
    manifest_nonce: Buffer.from(record.manifestNonce),
    manifest_algorithm: record.manifestAlgorithm,
    manifest_aad_hash: Buffer.from(record.manifestAadHash),
    client_crypto_version: record.clientCryptoVersion,
    expires_at: record.expiresAt,
    failure_reason: record.failureReason ?? null,
    storage_metadata: record.storageMetadata ?? null,
    uploaded_at: record.uploadedAt ?? null,
    ready_at: record.readyAt ?? null,
    activated_at: record.activatedAt ?? null,
    superseded_at: record.supersededAt ?? null,
  };
}

function packagePatch(patch: Partial<VaultPackageRecord>): Record<string, unknown> {
  const row = packageRow({
    id: "00000000-0000-0000-0000-000000000000",
    vaultId: "00000000-0000-0000-0000-000000000000",
    shareGenerationId: "00000000-0000-0000-0000-000000000000",
    versionNo: 1,
    version: 0,
    status: "UPLOADING",
    objectKey: "00/00/00000000-0000-0000-0000-000000000000",
    uploadId: "placeholder",
    cipherAlgorithm: "placeholder",
    streamHeader: new Uint8Array(24),
    ciphertextSize: 0,
    ciphertextSha256: "00".repeat(32),
    dekEnvelope: new Uint8Array([0]),
    dekEnvelopeNonce: new Uint8Array([0]),
    dekEnvelopeAlgorithm: "placeholder",
    dekEnvelopeProtocolVersion: 1,
    dekEnvelopeAadHash: new Uint8Array([0]),
    manifestCiphertext: new Uint8Array([0]),
    manifestNonce: new Uint8Array([0]),
    manifestAlgorithm: "placeholder",
    manifestAadHash: new Uint8Array([0]),
    clientCryptoVersion: "placeholder",
    expiresAt: new Date(0).toISOString(),
    ...patch,
  });
  const keyMap: Record<keyof VaultPackageRecord, string> = {
    id: "id",
    vaultId: "vault_id",
    shareGenerationId: "share_generation_id",
    versionNo: "version_no",
    version: "version",
    status: "status",
    objectKey: "object_key",
    uploadId: "upload_id",
    cipherAlgorithm: "cipher_algorithm",
    streamHeader: "stream_header",
    ciphertextSize: "ciphertext_size",
    ciphertextSha256: "ciphertext_sha256",
    dekEnvelope: "dek_envelope",
    dekEnvelopeNonce: "dek_envelope_nonce",
    dekEnvelopeAlgorithm: "dek_envelope_algorithm",
    dekEnvelopeProtocolVersion: "dek_envelope_protocol_version",
    dekEnvelopeAadHash: "dek_envelope_aad_hash",
    manifestCiphertext: "manifest_ciphertext",
    manifestNonce: "manifest_nonce",
    manifestAlgorithm: "manifest_algorithm",
    manifestAadHash: "manifest_aad_hash",
    clientCryptoVersion: "client_crypto_version",
    expiresAt: "expires_at",
    uploadedAt: "uploaded_at",
    readyAt: "ready_at",
    activatedAt: "activated_at",
    supersededAt: "superseded_at",
    failureReason: "failure_reason",
    storageMetadata: "storage_metadata",
  };
  return Object.fromEntries(
    (Object.keys(patch) as Array<keyof VaultPackageRecord>)
      .filter((key) => key !== "id" && key !== "version")
      .map((key) => [keyMap[key], row[keyMap[key]]]),
  );
}

function packagesFor(tx: TransactionContext): VaultPackageRepository {
  const repository = tx.repositories.packages;
  return {
    async create(record) {
      return packageRecord(await repository.insert(packageRow(record)));
    },
    async findById(id, options) {
      const row = await repository.findById(id, options);
      return row === null ? null : packageRecord(row);
    },
    async findActive(vaultId, options) {
      const rows = (await repository.findMany?.("vault_id", vaultId, options)) ?? [];
      const row = rows.find((candidate) => candidate.status === "ACTIVE");
      return row === undefined ? null : packageRecord(row);
    },
    async findCurrentShareGenerationId(vaultId, options) {
      const vault = await tx.repositories.vaults.findById(vaultId, options);
      const generationId = vault?.active_share_generation_id;
      if (typeof generationId !== "string" || generationId.length === 0) {
        throw new VaultUseCaseError(
          "DLS-SHARE-GENERATION-MISMATCH",
          "vault has no active share generation",
          409,
        );
      }
      return generationId;
    },
    async lockVault(vaultId) {
      if ((await tx.repositories.vaults.findById(vaultId, { forUpdate: true })) === null) {
        throw new VaultUseCaseError("DLS-VAULT-NOT-FOUND", "vault not found", 404);
      }
    },
    async update(id, expectedVersion, patch) {
      return packageRecord(
        await repository.updateVersioned(id, expectedVersion, packagePatch(patch)),
      );
    },
    async list(vaultId) {
      const rows = (await repository.findMany?.("vault_id", vaultId)) ?? [];
      return rows.map(packageRecord).sort((left, right) => right.versionNo - left.versionNo);
    },
  };
}

class TransactionalVaultPackages implements VaultPackageRepository {
  public constructor(private readonly transaction: TransactionManager) {}
  public create(record: VaultPackageRecord) {
    return this.transaction.run((tx) => packagesFor(tx).create(record));
  }
  public findById(id: string, options?: { forUpdate?: boolean }) {
    return this.transaction.run((tx) => packagesFor(tx).findById(id, options));
  }
  public findActive(vaultId: string, options?: { forUpdate?: boolean }) {
    return this.transaction.run((tx) => packagesFor(tx).findActive(vaultId, options));
  }
  public findCurrentShareGenerationId(vaultId: string, options?: { forUpdate?: boolean }) {
    return this.transaction.run((tx) =>
      packagesFor(tx).findCurrentShareGenerationId(vaultId, options),
    );
  }
  public lockVault(vaultId: string) {
    return this.transaction.run((tx) => packagesFor(tx).lockVault(vaultId));
  }
  public update(id: string, expectedVersion: number, patch: Partial<VaultPackageRecord>) {
    return this.transaction.run((tx) => packagesFor(tx).update(id, expectedVersion, patch));
  }
  public list(vaultId: string) {
    return this.transaction.run((tx) => packagesFor(tx).list(vaultId));
  }
}

function vaultTransactions(transaction: TransactionManager): VaultTransactionRunner {
  return {
    run: (work) =>
      transaction.run((tx) =>
        work({
          packages: packagesFor(tx),
          clock: tx.clock,
          outbox: tx.outbox,
          audit: tx.audit,
        } satisfies VaultTransactionContext),
      ),
  };
}

export class PostgresVaultRuntime implements VaultRuntime {
  readonly #packages: VaultPackageRepository;
  readonly #storage: ReturnType<typeof createStorage>;
  readonly #vaultTransactions: VaultTransactionRunner;

  public constructor(
    private readonly transaction: TransactionManager,
    storage: ReturnType<typeof createStorage>,
  ) {
    this.#packages = new TransactionalVaultPackages(transaction);
    this.#storage = storage;
    this.#vaultTransactions = vaultTransactions(transaction);
  }

  public createUploadSession(input: CreateUploadSessionInput, _context: VaultRequestContext) {
    return this.transaction.run(
      async (tx) => {
        const vaultId = await this.singletonVaultId(tx);
        if (input.vaultId !== vaultId) {
          throw new VaultUseCaseError(
            "DLS-VAULT-MISMATCH",
            "upload target does not match the owner vault",
            403,
          );
        }
        const packages = packagesFor(tx);
        const existing = await packages.list(vaultId);
        return new CreateUploadSession({
          packages,
          idFactory: randomUUID,
          objectKeyFactory: buildObjectKey,
          nextVersionNo: async () => Math.max(0, ...existing.map((record) => record.versionNo)) + 1,
        }).execute(input);
      },
      { isolation: "serializable" },
    );
  }

  public streamUpload(input: StreamUploadInput, _context: VaultRequestContext) {
    return new StreamUpload({
      packages: this.#packages,
      storage: this.#storage,
      clock: { now: () => this.transaction.run((tx) => tx.clock.now()) },
    }).execute(input);
  }

  public completeUpload(input: CompleteUploadInput, _context: VaultRequestContext) {
    return new CompleteUpload({
      packages: this.#packages,
      storage: this.#storage,
      clock: { now: () => this.transaction.run((tx) => tx.clock.now()) },
    }).execute(input);
  }

  public activatePackage(input: ActivatePackageInput, _context: VaultRequestContext) {
    return new ActivatePackage({
      packages: this.#packages,
      storage: this.#storage,
      transaction: this.#vaultTransactions,
      passwordVerifier: { verify: (password) => this.verifyOwnerPassword(password) },
      idFactory: randomUUID,
    }).execute(input);
  }

  public async listPackages(_context: VaultRequestContext) {
    const vaultId = await this.transaction.run((tx) => this.singletonVaultId(tx));
    return this.#packages.list(vaultId);
  }

  public abortUpload(
    input: Readonly<{ packageId: string; uploadId: string }>,
    _context: VaultRequestContext,
  ) {
    return new AbortUpload({
      packages: this.#packages,
      storage: this.#storage,
      transaction: this.#vaultTransactions,
    }).execute(input);
  }

  private async singletonVaultId(tx: TransactionContext): Promise<string> {
    const vault = await tx.repositories.vaults.findFirst?.();
    if (vault === null || vault === undefined || typeof vault.id !== "string") {
      throw new VaultUseCaseError("DLS-VAULT-NOT-FOUND", "owner vault is unavailable", 404);
    }
    return vault.id;
  }

  private async verifyOwnerPassword(password: string): Promise<void> {
    const credential = await this.transaction.run((tx) =>
      tx.repositories.ownerCredentials.findById(true),
    );
    const hash = credential?.password_phc;
    const valid =
      typeof hash === "string" &&
      (await verifyServerPassword(password, getApiRuntimeConfig().tokenPepper, hash));
    if (!valid)
      throw new VaultUseCaseError(
        "DLS-OWNER-REAUTH",
        "owner password reauthentication failed",
        401,
      );
  }
}

export function createVaultRuntime(): VaultRuntime {
  const config = getPublicRuntimeConfig();
  return new PostgresVaultRuntime(
    new PgTransactionManager(createPgPool({ connectionString: config.databaseUrl })),
    createStorage(config.storage),
  );
}
