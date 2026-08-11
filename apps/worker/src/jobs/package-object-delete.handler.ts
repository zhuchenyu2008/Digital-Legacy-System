import type { ObjectStoragePort, TransactionManager } from "@dls/application";
import { createPgPool, PgTransactionManager } from "@dls/persistence";
import { createStorage } from "@dls/storage";
import { loadWorkerConfig } from "../config/load-config.js";
import type { WorkerJob } from "./register-handlers.js";

type PackageDeleteTarget = Readonly<{
  status: string;
  objectKey: string;
  activeObjectKey?: string;
}>;

type PackageTargetReader = (packageId: string) => Promise<PackageDeleteTarget | null>;

export class PackageObjectDeleteHandler {
  public constructor(
    private readonly readTarget: PackageTargetReader,
    private readonly storage: Pick<ObjectStoragePort, "delete">,
  ) {}

  public async handle(job: WorkerJob): Promise<void> {
    const target = await this.readTarget(job.data.aggregateId);
    if (target === null) return;
    if (target.status === "ACTIVE" || target.objectKey === target.activeObjectKey) {
      throw new Error("refusing to delete the active package object");
    }
    const namespace =
      target.status === "ABORTED"
        ? "staging"
        : target.status === "SUPERSEDED"
          ? "private"
          : undefined;
    if (namespace === undefined) {
      throw new Error(`package object deletion is invalid for status ${target.status}`);
    }
    await this.storage.delete(namespace, target.objectKey);
  }
}

function packageTargetReader(transaction: TransactionManager): PackageTargetReader {
  return (packageId) =>
    transaction.run(async (tx) => {
      const row = await tx.repositories.packages.findById(packageId);
      if (row === null) return null;
      const rows = (await tx.repositories.packages.findMany?.("vault_id", row.vault_id)) ?? [];
      const active = rows.find((candidate) => candidate.status === "ACTIVE");
      return {
        status: String(row.status),
        objectKey: String(row.object_key),
        ...(active === undefined ? {} : { activeObjectKey: String(active.object_key) }),
      };
    });
}

export function createPackageObjectDeleteHandler(): PackageObjectDeleteHandler {
  const config = loadWorkerConfig();
  const storageConfig =
    config.storage.driver === "filesystem"
      ? config.storage
      : {
          ...config.storage,
          endpoint:
            config.storage.endpoint?.toString() ??
            `https://s3.${config.storage.region}.amazonaws.com`,
        };
  const transaction = new PgTransactionManager(
    createPgPool({ connectionString: config.databaseUrl }),
  );
  return new PackageObjectDeleteHandler(
    packageTargetReader(transaction),
    createStorage(storageConfig),
  );
}
