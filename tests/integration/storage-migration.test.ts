import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  inventoryFilesystem,
  migrateFilesystemToStorage,
  migrateStorageInventory,
  verifyFilesystemInventory,
} from "../../packages/storage/src/cli/inventory.js";
import { atomicStorageDriverSwitch } from "../../packages/storage/src/cli/migrate-storage.js";
import { FilesystemStorage } from "../../packages/storage/src/filesystem/filesystem-storage.js";
import { chunks, readAll } from "../../packages/storage/src/testing/storage-contract.js";

describe("operator-driven filesystem storage migration", () => {
  it("inventories, copies, and verifies private/staging/public objects by digest", async () => {
    const source = await mkdtemp(join(tmpdir(), "dls-storage-source-"));
    const target = await mkdtemp(join(tmpdir(), "dls-storage-target-"));
    try {
      const sourceStorage = new FilesystemStorage({
        privateRoot: join(source, "private"),
        stagingRoot: join(source, "staging"),
        publicRoot: join(source, "public"),
      });
      const targetStorage = new FilesystemStorage({
        privateRoot: join(target, "private"),
        stagingRoot: join(target, "staging"),
        publicRoot: join(target, "public"),
      });
      const key = "aa/aa/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      const body = Uint8Array.from([1, 2, 3, 4]);
      await sourceStorage.put({ namespace: "private", key, body: chunks([body]) });
      const inventory = await inventoryFilesystem({
        privateRoot: join(source, "private"),
        stagingRoot: join(source, "staging"),
        publicRoot: join(source, "public"),
      });
      expect(inventory.objects).toHaveLength(1);
      expect(inventory.objects[0]?.sha256).toHaveLength(64);

      await migrateFilesystemToStorage(inventory, {
        private: targetStorage,
        staging: targetStorage,
        public: targetStorage,
      });
      await verifyFilesystemInventory(inventory, {
        private: targetStorage,
        staging: targetStorage,
        public: targetStorage,
      });
      expect(await readAll((await targetStorage.read("private", key)).body)).toEqual(body);
    } finally {
      await rm(source, { recursive: true, force: true });
      await rm(target, { recursive: true, force: true });
    }
  });

  it("accepts an empty target and rejects a conflicting digest", async () => {
    const source = await mkdtemp(join(tmpdir(), "dls-storage-source-"));
    const target = await mkdtemp(join(tmpdir(), "dls-storage-target-"));
    try {
      const sourceRoots = {
        privateRoot: join(source, "private"),
        stagingRoot: join(source, "staging"),
        publicRoot: join(source, "public"),
      };
      const targetStorage = new FilesystemStorage({
        privateRoot: join(target, "private"),
        stagingRoot: join(target, "staging"),
        publicRoot: join(target, "public"),
      });
      const sourceStorage = new FilesystemStorage(sourceRoots);
      const key = "aa/aa/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      await sourceStorage.put({ namespace: "private", key, body: chunks([Uint8Array.of(1)]) });
      await targetStorage.put({ namespace: "private", key, body: chunks([Uint8Array.of(2)]) });
      const inventory = await inventoryFilesystem(sourceRoots);
      await expect(
        migrateFilesystemToStorage(inventory, {
          private: targetStorage,
          staging: targetStorage,
          public: targetStorage,
        }),
      ).rejects.toThrow(/different digest/iu);
    } finally {
      await rm(source, { recursive: true, force: true });
      await rm(target, { recursive: true, force: true });
    }
  });

  it("resumes through StoragePort sources and switches STORAGE_DRIVER atomically", async () => {
    const source = await mkdtemp(join(tmpdir(), "dls-storage-source-"));
    const target = await mkdtemp(join(tmpdir(), "dls-storage-target-"));
    try {
      const sourceStorage = new FilesystemStorage({
        privateRoot: join(source, "private"),
        stagingRoot: join(source, "staging"),
        publicRoot: join(source, "public"),
      });
      const targetStorage = new FilesystemStorage({
        privateRoot: join(target, "private"),
        stagingRoot: join(target, "staging"),
        publicRoot: join(target, "public"),
      });
      const key = "bb/bb/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
      await sourceStorage.put({ namespace: "public", key, body: chunks([Uint8Array.of(3, 4)]) });
      const inventory = await inventoryFilesystem({
        privateRoot: join(source, "private"),
        stagingRoot: join(source, "staging"),
        publicRoot: join(source, "public"),
      });
      const journal = join(target, "migration.journal");
      const sources = { private: sourceStorage, staging: sourceStorage, public: sourceStorage };
      const destinations = {
        private: targetStorage,
        staging: targetStorage,
        public: targetStorage,
      };
      await migrateStorageInventory(inventory, destinations, { journalPath: journal, sources });
      await migrateStorageInventory(inventory, destinations, { journalPath: journal, sources });
      expect((await readFile(journal, "utf8")).trim().split(/\r?\n/u)).toHaveLength(1);

      const envFile = join(target, ".env.production");
      await writeFile(envFile, "DLS_DOMAIN=legacy.example\nSTORAGE_DRIVER=filesystem\n", "utf8");
      await atomicStorageDriverSwitch(envFile, "filesystem", "s3");
      expect(await readFile(envFile, "utf8")).toContain("STORAGE_DRIVER=s3");
      await expect(atomicStorageDriverSwitch(envFile, "filesystem", "s3")).rejects.toThrow(
        /changed during migration/iu,
      );
    } finally {
      await rm(source, { recursive: true, force: true });
      await rm(target, { recursive: true, force: true });
    }
  });
});
