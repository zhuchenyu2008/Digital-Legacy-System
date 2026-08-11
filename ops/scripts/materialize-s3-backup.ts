import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ObjectNamespace, ObjectStoragePort } from "@dls/application";
import {
  FilesystemStorage,
  migrateStorageInventory,
  S3Storage,
  type StorageInventory,
  verifyFilesystemInventory,
} from "@dls/storage";

type DatabaseObject = Readonly<{
  objectKey: string;
  bytes: number;
  sha256: string;
}>;

type DatabaseInventory = Readonly<{
  packages: readonly (DatabaseObject & Readonly<{ status: string }>)[];
  publications: readonly DatabaseObject[];
}>;

function databaseInventory(value: unknown): DatabaseInventory {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("database inventory must be an object");
  }
  const record = value as Partial<DatabaseInventory>;
  if (!Array.isArray(record.packages) || !Array.isArray(record.publications)) {
    throw new Error("database inventory object references are missing");
  }
  return record as DatabaseInventory;
}

function objectMetadata(value: DatabaseObject, label: string): DatabaseObject {
  if (
    typeof value.objectKey !== "string" ||
    value.objectKey.length === 0 ||
    !Number.isSafeInteger(value.bytes) ||
    value.bytes < 0 ||
    !/^[0-9a-f]{64}$/u.test(value.sha256)
  ) {
    throw new Error(`database inventory object metadata is invalid: ${label}`);
  }
  return value;
}

function storageInventory(value: unknown): StorageInventory {
  const database = databaseInventory(value);
  const objects = new Map<string, StorageInventory["objects"][number]>();
  const add = (namespace: ObjectNamespace, item: DatabaseObject, label: string) => {
    const metadata = objectMetadata(item, label);
    const identity = `${namespace}/${metadata.objectKey}`;
    const candidate = {
      namespace,
      key: metadata.objectKey,
      sourcePath: `s3://${identity}`,
      bytes: metadata.bytes,
      sha256: metadata.sha256,
    } as const;
    const existing = objects.get(identity);
    if (
      existing !== undefined &&
      (existing.bytes !== candidate.bytes || existing.sha256 !== candidate.sha256)
    ) {
      throw new Error(`conflicting database object references: ${identity}`);
    }
    objects.set(identity, candidate);
  };

  for (const [index, item] of database.packages.entries()) {
    const namespace = ["UPLOADING", "VALIDATING", "READY"].includes(item.status)
      ? "staging"
      : ["ACTIVE", "SUPERSEDED", "DELETE_PENDING"].includes(item.status)
        ? "private"
        : undefined;
    if (namespace !== undefined) add(namespace, item, `package ${index}`);
  }
  for (const [index, item] of database.publications.entries()) {
    add("public", item, `publication ${index}`);
  }
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    objects: [...objects.values()].sort((left, right) =>
      `${left.namespace}/${left.key}`.localeCompare(`${right.namespace}/${right.key}`, "en"),
    ),
  };
}

export async function materializeDatabaseReferencedObjects(
  inventoryValue: unknown,
  source: ObjectStoragePort,
  targetRoot: string,
): Promise<Readonly<{ objects: number; bytes: number }>> {
  const inventory = storageInventory(inventoryValue);
  const root = resolve(targetRoot);
  const destination = new FilesystemStorage({
    privateRoot: resolve(root, "private"),
    stagingRoot: resolve(root, "staging"),
    publicRoot: resolve(root, "public"),
  });
  const storageByNamespace = {
    private: destination,
    staging: destination,
    public: destination,
  } as const;
  const sourceByNamespace = { private: source, staging: source, public: source } as const;
  await migrateStorageInventory(inventory, storageByNamespace, { sources: sourceByNamespace });
  await verifyFilesystemInventory(inventory, storageByNamespace);
  return {
    objects: inventory.objects.length,
    bytes: inventory.objects.reduce((total, object) => total + object.bytes, 0),
  };
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? undefined : process.argv[index + 1];
  if (index >= 0 && (value === undefined || value.startsWith("--"))) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

async function environmentFile(path: string | undefined): Promise<Record<string, string>> {
  if (path === undefined) return {};
  const output: Record<string, string> = {};
  for (const line of (await readFile(resolve(path), "utf8")).split(/\r?\n/gu)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) throw new Error("S3 environment file contains an invalid line");
    const name = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    output[name] = value;
  }
  return output;
}

async function credential(
  environment: Readonly<Record<string, string | undefined>>,
  valueName: string,
  fileName: string,
): Promise<string> {
  const direct = environment[valueName];
  if (direct?.length) return direct;
  const path = environment[fileName];
  if (!path) throw new Error(`${valueName} or ${fileName} is required`);
  const value = (await readFile(resolve(path), "utf8")).trim();
  if (value.length === 0) throw new Error(`${fileName} is empty`);
  return value;
}

async function main(): Promise<void> {
  const databaseState = option("--database-state");
  const targetRoot = option("--target-root");
  if (databaseState === undefined || targetRoot === undefined) {
    throw new Error(
      "usage: materialize-s3-backup.ts --database-state inventory.json --target-root objects [--env-file .env.production]",
    );
  }
  const configured = {
    ...(await environmentFile(option("--env-file"))),
    ...process.env,
  };
  const region = configured.S3_REGION ?? configured.DLS_S3_REGION ?? "us-east-1";
  const source = new S3Storage({
    endpoint:
      configured.S3_ENDPOINT ?? configured.DLS_S3_ENDPOINT ?? `https://s3.${region}.amazonaws.com`,
    region,
    forcePathStyle:
      (configured.S3_FORCE_PATH_STYLE ?? configured.DLS_S3_FORCE_PATH_STYLE) === "true",
    privateBucket: configured.S3_PRIVATE_BUCKET ?? configured.DLS_S3_PRIVATE_BUCKET ?? "",
    stagingBucket: configured.S3_STAGING_BUCKET ?? configured.DLS_S3_STAGING_BUCKET ?? "",
    publicBucket: configured.S3_PUBLIC_BUCKET ?? configured.DLS_S3_PUBLIC_BUCKET ?? "",
    credentials: {
      accessKeyId: await credential(configured, "S3_ACCESS_KEY_ID", "DLS_S3_ACCESS_KEY_FILE"),
      secretAccessKey: await credential(
        configured,
        "S3_SECRET_ACCESS_KEY",
        "DLS_S3_SECRET_KEY_FILE",
      ),
    },
  });
  const result = await materializeDatabaseReferencedObjects(
    JSON.parse(await readFile(resolve(databaseState), "utf8")) as unknown,
    source,
    targetRoot,
  );
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
