import type { ObjectStoragePort } from "../ports/object-storage.js";
import type {
  VaultPackageRecord,
  VaultPackageRepository,
  VaultTransactionRunner,
} from "./ports.js";
import { VaultUseCaseError } from "./ports.js";

export class AbortUpload {
  constructor(
    private readonly dependencies: Readonly<{
      packages: VaultPackageRepository;
      storage: ObjectStoragePort;
      transaction: VaultTransactionRunner;
    }>,
  ) {}

  async execute(input: Readonly<{ packageId: string; uploadId: string }>) {
    const current = await this.dependencies.packages.findById(input.packageId);
    if (current === null)
      throw new VaultUseCaseError("DLS-PACKAGE-NOT-FOUND", "package not found", 404);
    if (current.uploadId !== input.uploadId)
      throw new VaultUseCaseError("DLS-UPLOAD-TOKEN", "upload session mismatch", 409);
    if (current.status === "ABORTED") {
      await this.cleanupStaging(current);
      return current;
    }
    if (current.status !== "UPLOADING" && current.status !== "FAILED") {
      throw new VaultUseCaseError("DLS-PACKAGE-STATE", "package cannot be aborted", 409);
    }
    const aborted = await this.dependencies.transaction.run(async (tx) => {
      const locked = await tx.packages.findById(input.packageId, { forUpdate: true });
      if (locked === null)
        throw new VaultUseCaseError("DLS-PACKAGE-NOT-FOUND", "package not found", 404);
      if (locked.status === "ABORTED") return locked;
      if (locked.status !== "UPLOADING" && locked.status !== "FAILED") {
        throw new VaultUseCaseError("DLS-PACKAGE-STATE", "package cannot be aborted", 409);
      }
      return tx.packages.update(locked.id, locked.version, { status: "ABORTED" });
    });
    await this.cleanupStaging(aborted);
    return aborted;
  }

  private async cleanupStaging(record: VaultPackageRecord) {
    try {
      await this.dependencies.storage.delete("staging", record.objectKey);
    } catch {
      await this.dependencies.transaction.run((tx) =>
        tx.outbox.enqueue({
          eventType: "DELETE_STAGING_PACKAGE_OBJECT",
          aggregateType: "legacy_package",
          aggregateId: record.id,
          payload: { namespace: "staging", objectKey: record.objectKey },
          idempotencyKey: `legacy-package:${record.id}:delete-staging:${record.objectKey}`,
        }),
      );
    }
  }
}
