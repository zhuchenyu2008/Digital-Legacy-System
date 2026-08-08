import { createHash } from "node:crypto";
import type { ObjectStoragePort } from "../ports/object-storage.js";
import type {
  OwnerPasswordVerifier,
  VaultPackageRepository,
  VaultTransactionRunner,
} from "./ports.js";
import { VaultUseCaseError } from "./ports.js";

export type ActivatePackageInput = Readonly<{
  packageId: string;
  password: string;
  expectedCurrentPackageId?: string;
  expectedShareGenerationId?: string;
  actorId: string;
}>;

export class ActivatePackage {
  constructor(
    private readonly dependencies: Readonly<{
      packages: VaultPackageRepository;
      storage: ObjectStoragePort;
      transaction: VaultTransactionRunner;
      passwordVerifier: OwnerPasswordVerifier;
      idFactory: () => string;
    }>,
  ) {}

  async execute(input: ActivatePackageInput) {
    await this.dependencies.passwordVerifier.verify(input.password);
    const candidate = await this.dependencies.packages.findById(input.packageId);
    if (candidate === null)
      throw new VaultUseCaseError("DLS-PACKAGE-NOT-FOUND", "package not found", 404);
    if (candidate.status === "ACTIVE") {
      if (
        input.expectedCurrentPackageId !== undefined &&
        input.expectedCurrentPackageId !== candidate.id
      ) {
        throw new VaultUseCaseError("DLS-VERSION-CONFLICT", "current active package changed", 409);
      }
      if (
        input.expectedShareGenerationId !== undefined &&
        input.expectedShareGenerationId !== candidate.shareGenerationId
      ) {
        throw new VaultUseCaseError("DLS-VERSION-CONFLICT", "share generation changed", 409);
      }
      return candidate;
    }
    if (candidate.status !== "READY")
      throw new VaultUseCaseError("DLS-PACKAGE-STATE", "only READY packages can be activated", 409);

    await this.dependencies.storage.promote({
      from: "staging",
      to: "private",
      sourceKey: candidate.objectKey,
      destinationKey: candidate.objectKey,
      expectedSha256: candidate.ciphertextSha256,
    });
    try {
      return await this.dependencies.transaction.run(async (tx) => {
        await tx.packages.lockVault(candidate.vaultId);
        const lockedCandidate = await tx.packages.findById(candidate.id, { forUpdate: true });
        if (lockedCandidate === null)
          throw new VaultUseCaseError("DLS-PACKAGE-NOT-FOUND", "package not found", 404);
        if (lockedCandidate.status !== "READY")
          throw new VaultUseCaseError(
            "DLS-PACKAGE-STATE",
            "package changed before activation",
            409,
          );
        const currentGeneration = await tx.packages.findCurrentShareGenerationId(
          candidate.vaultId,
          { forUpdate: true },
        );
        if (
          input.expectedShareGenerationId !== undefined &&
          currentGeneration !== input.expectedShareGenerationId
        ) {
          throw new VaultUseCaseError("DLS-VERSION-CONFLICT", "share generation changed", 409);
        }
        if (lockedCandidate.shareGenerationId !== currentGeneration) {
          throw new VaultUseCaseError(
            "DLS-VERSION-CONFLICT",
            "package uses a stale share generation",
            409,
          );
        }
        const current = await tx.packages.findActive(candidate.vaultId, { forUpdate: true });
        if (
          input.expectedCurrentPackageId !== undefined &&
          current?.id !== input.expectedCurrentPackageId
        ) {
          throw new VaultUseCaseError(
            "DLS-VERSION-CONFLICT",
            "current active package changed",
            409,
          );
        }
        const now = await tx.clock.now();
        if (current !== null) {
          await tx.packages.update(current.id, current.version, {
            status: "SUPERSEDED",
            supersededAt: now,
          });
          await tx.outbox.enqueue({
            eventType: "DELETE_PRIVATE_PACKAGE_OBJECT",
            aggregateType: "legacy_package",
            aggregateId: current.id,
            payload: { namespace: "private", objectKey: current.objectKey },
            idempotencyKey: `legacy-package:${current.id}:delete:${current.objectKey}`,
          });
        }
        const activated = await tx.packages.update(lockedCandidate.id, lockedCandidate.version, {
          status: "ACTIVE",
          activatedAt: now,
        });
        await tx.audit.append({
          eventId: this.dependencies.idFactory(),
          occurredAt: now,
          eventType: "PACKAGE_ACTIVATED",
          actorType: "OWNER",
          actorIdDigest: createHash("sha256").update(input.actorId, "utf8").digest(),
          aggregateType: "legacy_package",
          aggregateId: activated.id,
          result: "SUCCESS",
          metadata: { ciphertextSha256: activated.ciphertextSha256 },
        });
        return activated;
      });
    } catch (error) {
      const current = await this.dependencies.packages.findById(candidate.id);
      if (current?.status !== "ACTIVE") {
        await this.dependencies.storage
          .delete("private", candidate.objectKey)
          .catch(() => undefined);
      }
      throw error;
    }
  }
}
