import type { ObjectStoragePort } from "@dls/application";

import { FilesystemStorage } from "./filesystem/filesystem-storage.js";
import { S3Storage, type S3StorageConfig } from "./s3/s3-storage.js";

export type StorageFactoryConfig =
  | Readonly<{
      driver: "filesystem";
      privateRoot: string;
      stagingRoot: string;
      publicRoot: string;
    }>
  | Readonly<{
      driver: "s3";
      endpoint: string;
      region: string;
      forcePathStyle?: boolean;
      privateBucket: string;
      publicBucket: string;
      stagingBucket?: string;
      accessKeyId: string;
      secretAccessKey: string;
    }>;

export function createStorage(config: StorageFactoryConfig): ObjectStoragePort {
  if (config.driver === "filesystem") {
    return new FilesystemStorage(config);
  }
  const s3Config: S3StorageConfig = {
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle ?? false,
    privateBucket: config.privateBucket,
    publicBucket: config.publicBucket,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    ...(config.stagingBucket === undefined ? {} : { stagingBucket: config.stagingBucket }),
  };
  return new S3Storage(s3Config);
}
