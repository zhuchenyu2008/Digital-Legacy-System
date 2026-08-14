import { readFile } from "node:fs/promises";
import {
  countUndispatchedOutbox,
  createPgPool,
} from "../../packages/persistence/dist/index.js";
import { createStorage, reconcileStorageReferences } from "@dls/storage";

async function secret(name) {
  return (await readFile(`/run/secrets/${name}`, "utf8")).trim();
}

const environment = process.env;
const databaseUrl =
  environment.DATABASE_URL ??
  `postgresql://dls_worker:${encodeURIComponent(await secret("worker_db_password"))}@${environment.DATABASE_HOST ?? "postgres"}:5432/${environment.DATABASE_NAME ?? "dls"}`;
const storage =
  environment.STORAGE_DRIVER === "s3"
    ? createStorage({
        driver: "s3",
        endpoint: environment.S3_ENDPOINT ?? "",
        region: environment.S3_REGION ?? "",
        forcePathStyle: environment.S3_FORCE_PATH_STYLE === "true",
        privateBucket: environment.S3_PRIVATE_BUCKET ?? "",
        publicBucket: environment.S3_PUBLIC_BUCKET ?? "",
        ...(environment.S3_STAGING_BUCKET ? { stagingBucket: environment.S3_STAGING_BUCKET } : {}),
        accessKeyId: await secret("minio_access_key"),
        secretAccessKey: await secret("minio_secret_key"),
      })
    : createStorage({
        driver: "filesystem",
        privateRoot: environment.STORAGE_PRIVATE_ROOT ?? "",
        stagingRoot: environment.STORAGE_STAGING_ROOT ?? "",
        publicRoot: environment.STORAGE_PUBLIC_ROOT ?? "",
      });

const pool = createPgPool({ connectionString: databaseUrl });
try {
  const storageReferences = await reconcileStorageReferences(pool, storage);
  const undispatchedOutbox = await countUndispatchedOutbox(pool, 60);
  const failedJobs = await pool.query(
    "SELECT count(*)::int AS count FROM pgboss.job WHERE state = 'failed'",
  );
  const failedJobCount = Number(failedJobs.rows[0]?.count ?? 0);
  if (undispatchedOutbox !== 0 || failedJobCount !== 0) {
    throw new Error(
      `runtime reconciliation failed: undispatched=${undispatchedOutbox}, failedJobs=${failedJobCount}`,
    );
  }
  process.stdout.write(
    `${JSON.stringify({ storageReferences, undispatchedOutbox, failedJobs: failedJobCount })}\n`,
  );
} finally {
  await pool.end();
}
