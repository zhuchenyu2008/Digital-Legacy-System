import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ObjectStoragePort } from "@dls/application";
import { afterEach, describe, expect, it } from "vitest";
import { buildObjectKey } from "../object-key.js";
import { assertStorageContract, chunks } from "../testing/storage-contract.js";
import { FilesystemStorage } from "./filesystem-storage.js";

const roots: string[] = [];

async function createStorage(): Promise<ObjectStoragePort> {
  const root = await mkdtemp(join(tmpdir(), "dls-storage-test-"));
  roots.push(root);
  return new FilesystemStorage({
    privateRoot: join(root, "private"),
    stagingRoot: join(root, "staging"),
    publicRoot: join(root, "public"),
  });
}

afterEach(async () => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  }
});

describe("filesystem object storage", () => {
  it("satisfies the shared storage contract", async () => {
    await assertStorageContract(createStorage);
  });

  it("accepts server-generated segmented UUID keys and rejects client paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "dls-storage-path-test-"));
    roots.push(root);
    const storage = new FilesystemStorage({
      privateRoot: join(root, "private"),
      stagingRoot: join(root, "staging"),
      publicRoot: join(root, "public"),
    });
    const key = buildObjectKey("550e8400-e29b-41d4-a716-446655440000");
    await expect(
      storage.put({ namespace: "private", key, body: chunks([Uint8Array.of(1)]) }),
    ).resolves.toMatchObject({ bytes: 1 });
    for (const invalid of [
      "../outside",
      "550e8400\\e29b\\41d4\\a716\\446655440000",
      "/absolute/path",
      "CON",
      "é/550e8400-e29b-41d4-a716-446655440000",
    ]) {
      await expect(storage.head("private", invalid)).rejects.toThrow();
    }
  });

  it("cleans interrupted writes, preserves restart state, and handles concurrent conflicts", async () => {
    const root = await mkdtemp(join(tmpdir(), "dls-storage-restart-test-"));
    roots.push(root);
    const config = {
      privateRoot: join(root, "private"),
      stagingRoot: join(root, "staging"),
      publicRoot: join(root, "public"),
    };
    const storage = new FilesystemStorage(config);
    const key = buildObjectKey("550e8400-e29b-41d4-a716-446655440010");
    const interrupted = (async function* () {
      yield Uint8Array.of(1, 2, 3);
      throw new Error("simulated interruption");
    })();
    await expect(storage.put({ namespace: "staging", key, body: interrupted })).rejects.toThrow(
      "simulated interruption",
    );
    expect(await storage.head("staging", key)).toBeNull();
    const stagingParent = join(root, "staging", "55", "0e");
    expect(
      (await readdir(stagingParent)).filter((entry) => entry.endsWith(".uploading")),
    ).toHaveLength(0);

    const stableBody = Uint8Array.from([7, 8, 9]);
    const conflictingBody = Uint8Array.from([9, 8, 7]);
    const stableHash = createHash("sha256").update(stableBody).digest("hex");
    const conflictingHash = createHash("sha256").update(conflictingBody).digest("hex");
    const results = await Promise.allSettled([
      storage.put({
        namespace: "private",
        key,
        body: chunks([stableBody]),
        expectedSha256: stableHash,
      }),
      storage.put({
        namespace: "private",
        key,
        body: chunks([conflictingBody]),
        expectedSha256: conflictingHash,
      }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const restarted = new FilesystemStorage(config);
    const persisted = await restarted.head("private", key);
    expect(persisted?.bytes).toBe(3);
    expect([stableHash, conflictingHash]).toContain(persisted?.sha256);
  });
});
