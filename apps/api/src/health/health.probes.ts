import { access, constants } from "node:fs/promises";
import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import type { StorageFactoryConfig } from "@dls/storage";
import type { Pool } from "pg";
import { getApiRuntimeConfig } from "../config/api-runtime-config.js";
import type { HealthProbe } from "./health.service.js";

type Queryable = Pick<Pool, "query">;

export class PostgresHealthProbe implements HealthProbe {
  public constructor(private readonly database: Queryable) {}

  public async check(): Promise<void> {
    await this.database.query("SELECT 1 AS ok");
  }
}

export class StorageHealthProbe implements HealthProbe {
  public constructor(private readonly checkStorage: () => Promise<void>) {}

  public check(): Promise<void> {
    return this.checkStorage();
  }
}

export class WorkerHeartbeatHealthProbe implements HealthProbe {
  public constructor(
    private readonly database: Queryable,
    private readonly staleMs = getApiRuntimeConfig().workerHeartbeatStaleMs,
  ) {}

  public async check(): Promise<void> {
    const result = await this.database.query(
      `SELECT last_seen_at,
              EXTRACT(EPOCH FROM (clock_timestamp() - last_seen_at)) * 1000 AS age_ms
       FROM app.worker_heartbeats WHERE service = 'worker'`,
    );
    const row = result.rows[0] as { age_ms?: unknown } | undefined;
    const ageMs = Number(row?.age_ms);
    if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > this.staleMs) {
      throw new Error("worker heartbeat is stale");
    }
  }
}

async function checkFilesystemStorage(
  storage: Extract<StorageFactoryConfig, { driver: "filesystem" }>,
): Promise<void> {
  await Promise.all([
    access(storage.privateRoot, constants.R_OK | constants.W_OK),
    access(storage.stagingRoot, constants.R_OK | constants.W_OK),
    access(storage.publicRoot, constants.R_OK | constants.W_OK),
  ]);
}

async function checkS3Storage(
  storage: Extract<StorageFactoryConfig, { driver: "s3" }>,
): Promise<void> {
  const client = new S3Client({
    endpoint: storage.endpoint,
    region: storage.region,
    forcePathStyle: storage.forcePathStyle ?? false,
    credentials: { accessKeyId: storage.accessKeyId, secretAccessKey: storage.secretAccessKey },
  });
  try {
    const buckets = [storage.privateBucket, storage.publicBucket, storage.stagingBucket].filter(
      (bucket): bucket is string => bucket !== undefined,
    );
    await Promise.all(buckets.map((Bucket) => client.send(new HeadBucketCommand({ Bucket }))));
  } finally {
    client.destroy();
  }
}

export function createStorageHealthProbe(storage: StorageFactoryConfig): HealthProbe {
  return new StorageHealthProbe(() =>
    storage.driver === "filesystem" ? checkFilesystemStorage(storage) : checkS3Storage(storage),
  );
}
