import { resolve } from "node:path";
import type { StorageFactoryConfig } from "@dls/storage";
import { getApiRuntimeConfig } from "./api-runtime-config.js";

export type PublicRuntimeConfig = Readonly<{
  databaseUrl: string;
  storage: StorageFactoryConfig;
  maxConcurrentDownloads: number;
  bytesPerSecond: number;
}>;

function positiveEnvironmentInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function storageConfig(environment: Record<string, string | undefined>): StorageFactoryConfig {
  if (environment.STORAGE_DRIVER === "s3") {
    const region = environment.S3_REGION ?? "us-east-1";
    return Object.freeze({
      driver: "s3",
      endpoint: environment.S3_ENDPOINT ?? `https://s3.${region}.amazonaws.com`,
      region,
      forcePathStyle: environment.S3_FORCE_PATH_STYLE === "true",
      privateBucket: environment.S3_PRIVATE_BUCKET ?? "dls-private",
      publicBucket: environment.S3_PUBLIC_BUCKET ?? "dls-public",
      accessKeyId: environment.S3_ACCESS_KEY_ID ?? "missing",
      secretAccessKey: environment.S3_SECRET_ACCESS_KEY ?? "missing",
    });
  }
  return Object.freeze({
    driver: "filesystem",
    privateRoot: resolve(environment.STORAGE_PRIVATE_ROOT ?? ".data/objects/private"),
    stagingRoot: resolve(environment.STORAGE_STAGING_ROOT ?? ".data/objects/staging"),
    publicRoot: resolve(environment.STORAGE_PUBLIC_ROOT ?? ".data/objects/public"),
  });
}

export function getPublicRuntimeConfig(
  environment: Record<string, string | undefined> = process.env,
): PublicRuntimeConfig {
  return Object.freeze({
    databaseUrl: getApiRuntimeConfig(environment).databaseUrl,
    storage: storageConfig(environment),
    maxConcurrentDownloads: positiveEnvironmentInteger(
      environment.PUBLIC_DOWNLOAD_MAX_CONCURRENCY,
      4,
    ),
    bytesPerSecond: positiveEnvironmentInteger(
      environment.PUBLIC_DOWNLOAD_BYTES_PER_SECOND,
      8 * 1024 * 1024,
    ),
  });
}
