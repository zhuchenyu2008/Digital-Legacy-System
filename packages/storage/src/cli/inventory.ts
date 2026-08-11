import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { appendFile, lstat, readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import type { ObjectNamespace, ObjectStoragePort } from "@dls/application";
import { assertObjectKey } from "../object-key.js";

export type FilesystemRoots = Readonly<{
  privateRoot: string;
  stagingRoot: string;
  publicRoot: string;
}>;

export type InventoryObject = Readonly<{
  namespace: ObjectNamespace;
  key: string;
  sourcePath: string;
  bytes: number;
  sha256: string;
}>;

export type StorageInventory = Readonly<{
  version: 1;
  createdAt: string;
  objects: readonly InventoryObject[];
}>;

const namespaces = Object.freeze([
  ["private", "privateRoot"],
  ["staging", "stagingRoot"],
  ["public", "publicRoot"],
] as const);

async function digestFile(path: string): Promise<Readonly<{ bytes: number; sha256: string }>> {
  const bytes = await readFile(path);
  return {
    bytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

async function walk(
  root: string,
  current: string,
  output: InventoryObject[],
  namespace: ObjectNamespace,
): Promise<void> {
  let entries: Dirent<string>[];
  try {
    entries = await readdir(current, { withFileTypes: true, encoding: "utf8" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    const path = join(current, entry.name);
    const stats = await lstat(path);
    if (stats.isSymbolicLink()) throw new Error(`storage inventory refuses symlink: ${path}`);
    if (stats.isDirectory()) {
      await walk(root, path, output, namespace);
      continue;
    }
    if (!stats.isFile() || entry.name.endsWith(".uploading")) continue;
    const key = relative(root, path).split("\\").join("/");
    assertObjectKey(key);
    const metadata = await digestFile(path);
    output.push({ namespace, key, sourcePath: resolve(path), ...metadata });
  }
}

export async function inventoryFilesystem(roots: FilesystemRoots): Promise<StorageInventory> {
  const objects: InventoryObject[] = [];
  for (const [namespace, rootKey] of namespaces) {
    const root = resolve(roots[rootKey]);
    await walk(root, root, objects, namespace);
  }
  objects.sort((left, right) =>
    `${left.namespace}/${left.key}`.localeCompare(`${right.namespace}/${right.key}`),
  );
  return Object.freeze({ version: 1, createdAt: new Date().toISOString(), objects });
}

type StorageByNamespace = Readonly<Record<ObjectNamespace, ObjectStoragePort>>;

export async function migrateStorageInventory(
  inventory: StorageInventory,
  destinations: StorageByNamespace,
  options: Readonly<{ journalPath?: string; sources?: StorageByNamespace }> = {},
): Promise<void> {
  const completed = new Set<string>();
  if (options.journalPath !== undefined) {
    try {
      const journal = await readFile(options.journalPath, "utf8");
      for (const line of journal.split(/\r?\n/gu)) {
        if (line.length > 0) completed.add(line);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  for (const object of inventory.objects) {
    const storage = destinations[object.namespace];
    if (storage === undefined) throw new Error(`missing destination for ${object.namespace}`);
    const journalKey = `${object.namespace}/${object.key}:${object.sha256}`;
    if (completed.has(journalKey)) {
      const existing = await storage.head(object.namespace, object.key);
      if (existing?.bytes === object.bytes && existing.sha256 === object.sha256) continue;
    }
    let body: AsyncIterable<Uint8Array>;
    if (options.sources === undefined) {
      const sourceBytes = await readFile(object.sourcePath);
      if (sourceBytes.byteLength !== object.bytes)
        throw new Error(`source size changed for ${object.key}`);
      body = (async function* () {
        yield new Uint8Array(sourceBytes);
      })();
    } else {
      const source = options.sources[object.namespace];
      const metadata = await source.head(object.namespace, object.key);
      if (
        metadata === null ||
        metadata.bytes !== object.bytes ||
        metadata.sha256 !== object.sha256
      ) {
        throw new Error(`source object changed for ${object.namespace}/${object.key}`);
      }
      body = (await source.read(object.namespace, object.key)).body;
    }
    await storage.put({
      namespace: object.namespace,
      key: object.key,
      body,
      expectedBytes: object.bytes,
      expectedSha256: object.sha256,
    });
    if (options.journalPath !== undefined) {
      await appendFile(options.journalPath, `${journalKey}\n`, "utf8");
    }
  }
}

export async function migrateFilesystemToStorage(
  inventory: StorageInventory,
  destinations: StorageByNamespace,
  options: Readonly<{ journalPath?: string }> = {},
): Promise<void> {
  await migrateStorageInventory(inventory, destinations, options);
}

export async function verifyFilesystemInventory(
  inventory: StorageInventory,
  destinations: StorageByNamespace,
): Promise<void> {
  for (const object of inventory.objects) {
    const storage = destinations[object.namespace];
    if (storage === undefined) throw new Error(`missing destination for ${object.namespace}`);
    const metadata = await storage.head(object.namespace, object.key);
    if (metadata === null)
      throw new Error(`missing migrated object ${object.namespace}/${object.key}`);
    if (metadata.bytes !== object.bytes || metadata.sha256 !== object.sha256) {
      throw new Error(`migrated object digest mismatch for ${object.namespace}/${object.key}`);
    }
  }
}

export function assertInventoryManifest(value: unknown): StorageInventory {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("storage inventory must be an object");
  }
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || !Array.isArray(record.objects))
    throw new Error("storage inventory version is invalid");
  for (const object of record.objects) {
    if (object === null || typeof object !== "object" || Array.isArray(object))
      throw new Error("storage inventory object is invalid");
    const item = object as Record<string, unknown>;
    if (
      !["private", "staging", "public"].includes(String(item.namespace)) ||
      typeof item.key !== "string" ||
      typeof item.sourcePath !== "string" ||
      !Number.isSafeInteger(item.bytes) ||
      Number(item.bytes) < 0 ||
      typeof item.sha256 !== "string" ||
      !/^[0-9a-f]{64}$/u.test(item.sha256)
    ) {
      throw new Error("storage inventory object metadata is invalid");
    }
    assertObjectKey(item.key);
  }
  return record as unknown as StorageInventory;
}
