import { describe, expect, it } from "vitest";

import { assertStorageContract } from "../testing/storage-contract.js";
import { S3Storage, type S3StorageConfig } from "./s3-storage.js";

const s3Config: S3StorageConfig = {
  endpoint: process.env.S3_ENDPOINT ?? "http://127.0.0.1:9000",
  region: process.env.S3_REGION ?? "us-east-1",
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "minioadmin",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "minioadmin",
  },
  privateBucket: process.env.S3_PRIVATE_BUCKET ?? "dls-private",
  publicBucket: process.env.S3_PUBLIC_BUCKET ?? "dls-public",
};

describe("S3 object storage", () => {
  it.skipIf(process.env.DLS_S3_TEST !== "1")(
    "satisfies the shared contract against the configured MinIO/S3 endpoint",
    async () => {
      await assertStorageContract(() => new S3Storage(s3Config));
    },
  );

  it("validates required S3 configuration before constructing a client", () => {
    expect(() => new S3Storage({ ...s3Config, endpoint: "" })).toThrow(/endpoint/i);
    expect(() => new S3Storage({ ...s3Config, privateBucket: "" })).toThrow(/bucket/i);
  });
});
