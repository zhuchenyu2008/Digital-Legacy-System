import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FilesystemStorage } from "./filesystem/filesystem-storage.js";
import { createStorage } from "./storage-factory.js";

const roots: string[] = [];

afterEach(async () => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  }
});

describe("storage factory", () => {
  it("constructs filesystem storage without reading S3 configuration", async () => {
    const root = await mkdtemp(join(tmpdir(), "dls-storage-factory-"));
    roots.push(root);
    const storage = createStorage({
      driver: "filesystem",
      privateRoot: join(root, "private"),
      stagingRoot: join(root, "staging"),
      publicRoot: join(root, "public"),
    });
    expect(storage).toBeInstanceOf(FilesystemStorage);
  });

  it("rejects incomplete S3 configuration before app bootstrap", () => {
    expect(() =>
      createStorage({
        driver: "s3",
        endpoint: "",
        region: "us-east-1",
        privateBucket: "private",
        publicBucket: "public",
        accessKeyId: "",
        secretAccessKey: "",
      }),
    ).toThrow(/S3|endpoint|credential/i);
  });
});
