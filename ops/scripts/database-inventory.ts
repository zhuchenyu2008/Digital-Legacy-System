import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

type DatabaseInventory = Readonly<{
  version: 1;
  schemaVersion: number;
  counts: Readonly<Record<string, number>>;
  packages: readonly unknown[];
  publications: readonly unknown[];
  privateAuditFinalHash: string;
  publicAuditFinalHashes: Readonly<Record<string, string>>;
  outbox: Readonly<{ pending: number; published: number }>;
  jobs: Readonly<Record<string, number>>;
}>;

function isCountMap(value: unknown): value is Readonly<Record<string, number>> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.values(value).every((count) => Number.isSafeInteger(count) && count >= 0)
  );
}

export function assertDatabaseInventory(value: unknown): asserts value is DatabaseInventory {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("database inventory must be an object");
  }
  const inventory = value as Partial<DatabaseInventory>;
  if (
    inventory.version !== 1 ||
    !Number.isSafeInteger(inventory.schemaVersion) ||
    Number(inventory.schemaVersion) < 0 ||
    !isCountMap(inventory.counts) ||
    !Array.isArray(inventory.packages) ||
    !Array.isArray(inventory.publications) ||
    typeof inventory.privateAuditFinalHash !== "string" ||
    !isCountMap(inventory.outbox) ||
    !isCountMap(inventory.jobs) ||
    inventory.publicAuditFinalHashes === null ||
    typeof inventory.publicAuditFinalHashes !== "object" ||
    Array.isArray(inventory.publicAuditFinalHashes)
  ) {
    throw new Error("database inventory shape is invalid");
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function compareDatabaseInventories(expected: unknown, actual: unknown): void {
  assertDatabaseInventory(expected);
  assertDatabaseInventory(actual);
  if (canonical(expected) !== canonical(actual)) {
    throw new Error("restored database inventory does not match the backup inventory");
  }
}

type ManifestObject = Readonly<{ path: string; bytes: number; sha256: string }>;

function referencedObject(
  objects: ReadonlyMap<string, ManifestObject>,
  path: string,
  bytes: unknown,
  sha256: unknown,
): void {
  const object = objects.get(path);
  if (
    object === undefined ||
    !Number.isSafeInteger(bytes) ||
    object.bytes !== Number(bytes) ||
    typeof sha256 !== "string" ||
    object.sha256 !== sha256
  ) {
    throw new Error(`database object reference is missing or inconsistent: ${path}`);
  }
}

export function verifyDatabaseObjectReferences(
  inventoryValue: unknown,
  manifestValue: unknown,
): void {
  assertDatabaseInventory(inventoryValue);
  if (manifestValue === null || typeof manifestValue !== "object" || Array.isArray(manifestValue)) {
    throw new Error("backup manifest must be an object");
  }
  const manifestObjects = (manifestValue as { objects?: unknown }).objects;
  if (!Array.isArray(manifestObjects))
    throw new Error("backup manifest object inventory is missing");
  const objects = new Map<string, ManifestObject>();
  for (const value of manifestObjects) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("backup manifest object entry is invalid");
    }
    const object = value as Partial<ManifestObject>;
    if (
      typeof object.path !== "string" ||
      !Number.isSafeInteger(object.bytes) ||
      typeof object.sha256 !== "string"
    ) {
      throw new Error("backup manifest object entry is invalid");
    }
    objects.set(object.path, object as ManifestObject);
  }

  for (const value of inventoryValue.packages) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("database package inventory entry is invalid");
    }
    const item = value as Record<string, unknown>;
    const status = String(item.status);
    const namespace = ["UPLOADING", "VALIDATING", "READY"].includes(status)
      ? "staging"
      : ["ACTIVE", "SUPERSEDED", "DELETE_PENDING"].includes(status)
        ? "private"
        : undefined;
    if (namespace !== undefined) {
      referencedObject(objects, `${namespace}/${String(item.objectKey)}`, item.bytes, item.sha256);
    }
  }
  for (const value of inventoryValue.publications) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("database publication inventory entry is invalid");
    }
    const item = value as Record<string, unknown>;
    referencedObject(objects, `public/${String(item.objectKey)}`, item.bytes, item.sha256);
  }
}

async function main(): Promise<void> {
  if (process.argv[2] === "verify-references" && process.argv[3] !== undefined) {
    const directory = resolve(process.argv[3]);
    verifyDatabaseObjectReferences(
      JSON.parse(await readFile(resolve(directory, "database-state.json"), "utf8")) as unknown,
      JSON.parse(await readFile(resolve(directory, "manifest.json"), "utf8")) as unknown,
    );
    process.stdout.write("Database object references match backup objects\n");
    return;
  }
  if (
    process.argv[2] !== "compare" ||
    process.argv[3] === undefined ||
    process.argv[4] === undefined
  ) {
    throw new Error(
      "usage: database-inventory.ts <compare expected.json actual.json|verify-references backup-dir>",
    );
  }
  compareDatabaseInventories(
    JSON.parse(await readFile(resolve(process.argv[3]), "utf8")) as unknown,
    JSON.parse(await readFile(resolve(process.argv[4]), "utf8")) as unknown,
  );
  process.stdout.write("Database inventory matches backup\n");
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
