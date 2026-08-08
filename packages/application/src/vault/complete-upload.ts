import type { ObjectStoragePort } from "../ports/object-storage.js";
import type { EncryptedManifestVerifier, VaultPackageRepository } from "./ports.js";
import {
  assertCiphertextSha256,
  assertNotExpired,
  defaultManifestVerifier,
  VaultUseCaseError,
} from "./ports.js";

export type CompleteUploadInput = Readonly<{
  packageId: string;
  uploadId: string;
  ciphertextSize: number;
  ciphertextSha256: string;
  parts?: readonly Readonly<{ partNumber: number; etag: string }>[];
}>;

export class CompleteUpload {
  private readonly verifier: EncryptedManifestVerifier;

  constructor(
    private readonly dependencies: Readonly<{
      packages: VaultPackageRepository;
      storage: ObjectStoragePort;
      clock: { now(): Promise<string> };
      manifestVerifier?: EncryptedManifestVerifier;
    }>,
  ) {
    this.verifier = dependencies.manifestVerifier ?? defaultManifestVerifier();
  }

  async execute(input: CompleteUploadInput) {
    const record = await this.dependencies.packages.findById(input.packageId);
    if (record === null)
      throw new VaultUseCaseError("DLS-PACKAGE-NOT-FOUND", "package not found", 404);
    if (record.uploadId !== input.uploadId)
      throw new VaultUseCaseError("DLS-UPLOAD-TOKEN", "upload session mismatch", 409);
    if (input.ciphertextSize !== record.ciphertextSize)
      throw new VaultUseCaseError("DLS-PACKAGE-INTEGRITY", "ciphertext size mismatch");
    assertCiphertextSha256(input.ciphertextSha256);
    if (input.ciphertextSha256 !== record.ciphertextSha256)
      throw new VaultUseCaseError("DLS-PACKAGE-INTEGRITY", "ciphertext digest mismatch");
    if (record.status === "READY") return record;
    if (record.status !== "UPLOADING") {
      throw new VaultUseCaseError("DLS-PACKAGE-STATE", "package is not completing an upload", 409);
    }
    assertNotExpired(record.expiresAt, await this.dependencies.clock.now());
    this.validateParts(input.parts);

    const stored = await this.dependencies.storage.head("staging", record.objectKey);
    if (
      stored === null ||
      stored.bytes !== record.ciphertextSize ||
      stored.sha256 !== record.ciphertextSha256
    ) {
      throw new VaultUseCaseError(
        "DLS-PACKAGE-INTEGRITY",
        "stored ciphertext does not match upload metadata",
      );
    }
    await this.verifier.verify(record);
    const readyAt = await this.dependencies.clock.now();
    return this.dependencies.packages.update(record.id, record.version, {
      status: "READY",
      readyAt,
      ...(record.uploadedAt === undefined ? { uploadedAt: readyAt } : {}),
      storageMetadata: stored,
    });
  }

  private validateParts(parts: CompleteUploadInput["parts"]): void {
    if (parts === undefined) return;
    let expected = 1;
    for (const part of parts) {
      if (
        part.partNumber !== expected ||
        !Number.isSafeInteger(part.partNumber) ||
        part.partNumber < 1 ||
        part.etag.length === 0
      ) {
        throw new VaultUseCaseError("DLS-PACKAGE-INTEGRITY", "invalid multipart part list");
      }
      expected += 1;
    }
  }
}
