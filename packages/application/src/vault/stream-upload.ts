import type { DatabaseClock } from "../ports/database-clock.js";
import type { ObjectStoragePort } from "../ports/object-storage.js";
import type { VaultPackageRepository } from "./ports.js";
import { assertNotExpired, VaultUseCaseError } from "./ports.js";

export type StreamUploadInput = Readonly<{
  packageId: string;
  uploadId: string;
  contentLength: number;
  body: AsyncIterable<Uint8Array>;
  signal?: AbortSignal;
}>;

export class StreamUpload {
  constructor(
    private readonly dependencies: Readonly<{
      packages: VaultPackageRepository;
      storage: ObjectStoragePort;
      clock: DatabaseClock;
    }>,
  ) {}

  async execute(input: StreamUploadInput) {
    const record = await this.dependencies.packages.findById(input.packageId);
    if (record === null)
      throw new VaultUseCaseError("DLS-PACKAGE-NOT-FOUND", "package not found", 404);
    if (record.status !== "UPLOADING") {
      throw new VaultUseCaseError("DLS-PACKAGE-STATE", "package is not accepting uploads", 409);
    }
    if (record.uploadId !== input.uploadId) {
      throw new VaultUseCaseError("DLS-UPLOAD-TOKEN", "upload session does not match package", 409);
    }
    if (
      !Number.isSafeInteger(input.contentLength) ||
      input.contentLength !== record.ciphertextSize
    ) {
      throw new VaultUseCaseError(
        "DLS-PACKAGE-INTEGRITY",
        "Content-Length does not match encryptedSize",
        422,
      );
    }
    if (input.signal?.aborted)
      throw new VaultUseCaseError("DLS-UPLOAD-ABORTED", "upload was cancelled", 499);
    assertNotExpired(record.expiresAt, await this.dependencies.clock.now());

    const body = this.abortable(input.body, input.signal);
    let metadata: Awaited<ReturnType<ObjectStoragePort["put"]>>;
    try {
      metadata = await this.dependencies.storage.put({
        namespace: "staging",
        key: record.objectKey,
        body,
        expectedBytes: record.ciphertextSize,
        expectedSha256: record.ciphertextSha256,
      });
    } catch (error) {
      await this.dependencies.storage.delete("staging", record.objectKey).catch(() => undefined);
      throw error;
    }
    const uploadedAt = await this.dependencies.clock.now();
    return this.dependencies.packages.update(record.id, record.version, {
      uploadedAt,
      storageMetadata: metadata,
    });
  }

  private async *abortable(body: AsyncIterable<Uint8Array>, signal?: AbortSignal) {
    for await (const chunk of body) {
      if (signal?.aborted)
        throw new VaultUseCaseError("DLS-UPLOAD-ABORTED", "upload was cancelled", 499);
      yield chunk;
    }
    if (signal?.aborted)
      throw new VaultUseCaseError("DLS-UPLOAD-ABORTED", "upload was cancelled", 499);
  }
}
