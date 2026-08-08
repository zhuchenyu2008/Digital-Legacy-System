import { describe, expect, it } from "vitest";

import { assertStorageContract } from "../testing/storage-contract.js";
import { S3Storage, type S3StorageConfig } from "./s3-storage.js";

const testEnvironment =
  (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};
const s3Config: S3StorageConfig = {
  endpoint: testEnvironment.S3_ENDPOINT ?? "http://127.0.0.1:9000",
  region: testEnvironment.S3_REGION ?? "us-east-1",
  forcePathStyle: true,
  credentials: {
    accessKeyId: testEnvironment.S3_ACCESS_KEY_ID ?? "minioadmin",
    secretAccessKey: testEnvironment.S3_SECRET_ACCESS_KEY ?? "minioadmin",
  },
  privateBucket: testEnvironment.S3_PRIVATE_BUCKET ?? "dls-private",
  publicBucket: testEnvironment.S3_PUBLIC_BUCKET ?? "dls-public",
};

describe("S3 object storage", () => {
  it.skipIf(testEnvironment.DLS_S3_TEST !== "1")(
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
