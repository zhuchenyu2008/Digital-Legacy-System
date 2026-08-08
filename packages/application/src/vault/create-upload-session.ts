import {
  assertBytes,
  assertCiphertextSha256,
  DEFAULT_MAX_ENCRYPTED_BYTES,
  type EncryptedPackageMetadata,
  type VaultPackageRecord,
  type VaultPackageRepository,
  VaultUseCaseError,
} from "./ports.js";

export type CreateUploadSessionInput = EncryptedPackageMetadata & Readonly<{ expiresAt: string }>;

export type UploadSession = Readonly<{
  package: VaultPackageRecord;
  upload: Readonly<{
    mode: "API_STREAM";
    method: "PUT";
    url: string;
    expiresAt: string;
  }>;
}>;

export class CreateUploadSession {
  private readonly packages: VaultPackageRepository;
  private readonly idFactory: () => string;
  private readonly objectKeyFactory: (id: string) => string;
  private readonly nextVersionNo: () => Promise<number>;
  private readonly maxBytes: number;

  constructor(dependencies: {
    packages: VaultPackageRepository;
    idFactory: () => string;
    objectKeyFactory: (id: string) => string;
    nextVersionNo: () => Promise<number>;
    maxEncryptedBytes?: number;
  }) {
    this.packages = dependencies.packages;
    this.idFactory = dependencies.idFactory;
    this.objectKeyFactory = dependencies.objectKeyFactory;
    this.nextVersionNo = dependencies.nextVersionNo;
    this.maxBytes = dependencies.maxEncryptedBytes ?? DEFAULT_MAX_ENCRYPTED_BYTES;
  }

  async execute(input: CreateUploadSessionInput): Promise<UploadSession> {
    if (!Number.isSafeInteger(input.ciphertextSize) || input.ciphertextSize < 0) {
      throw new VaultUseCaseError(
        "DLS-PACKAGE-METADATA",
        "encryptedSize must be a non-negative safe integer",
      );
    }
    if (input.ciphertextSize > this.maxBytes) {
      throw new VaultUseCaseError(
        "DLS-PACKAGE-TOO-LARGE",
        "encrypted package exceeds deployment limit",
        413,
      );
    }
    assertCiphertextSha256(input.ciphertextSha256);
    for (const [value, field] of [
      [input.streamHeader, "streamHeader"],
      [input.dekEnvelope, "dekEnvelope"],
      [input.dekEnvelopeNonce, "dekEnvelopeNonce"],
      [input.dekEnvelopeAadHash, "dekEnvelopeAadHash"],
      [input.manifestCiphertext, "manifestCiphertext"],
      [input.manifestNonce, "manifestNonce"],
      [input.manifestAadHash, "manifestAadHash"],
    ] as const)
      assertBytes(value, field);
    if (input.streamHeader.length !== 24) {
      throw new VaultUseCaseError("DLS-PACKAGE-METADATA", "streamHeader must be 24 bytes");
    }
    if (input.dekEnvelopeProtocolVersion !== 1) {
      throw new VaultUseCaseError(
        "DLS-PACKAGE-METADATA",
        "unsupported DEK envelope protocol version",
      );
    }
    if (input.expiresAt.length === 0 || !Number.isFinite(Date.parse(input.expiresAt))) {
      throw new VaultUseCaseError(
        "DLS-PACKAGE-METADATA",
        "expiresAt must be an ISO-8601 timestamp",
      );
    }

    const id = this.idFactory();
    const record: VaultPackageRecord = {
      ...input,
      id,
      versionNo: await this.nextVersionNo(),
      version: 0,
      status: "UPLOADING",
      objectKey: this.objectKeyFactory(id),
      uploadId: this.idFactory(),
    };
    const created = await this.packages.create(record);
    return {
      package: created,
      upload: {
        mode: "API_STREAM",
        method: "PUT",
        url: `/api/v1/owner/packages/${created.id}/content`,
        expiresAt: created.expiresAt,
      },
    };
  }
}
