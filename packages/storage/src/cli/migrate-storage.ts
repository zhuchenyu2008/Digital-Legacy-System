import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { FilesystemStorage } from "../filesystem/filesystem-storage.js";
import { S3Storage } from "../s3/s3-storage.js";
import {
  assertInventoryManifest,
  inventoryFilesystem,
  migrateStorageInventory,
  verifyFilesystemInventory,
} from "./inventory.js";

function value(args: readonly string[], name: string): string {
  const index = args.indexOf(name);
  const result = index >= 0 ? args[index + 1] : undefined;
  if (result === undefined || result.length === 0) throw new Error(`${name} is required`);
  return result;
}

function optionalValue(args: readonly string[], name: string, fallback: string): string {
  const index = args.indexOf(name);
  return index >= 0 ? (args[index + 1] ?? fallback) : fallback;
}

type StorageCliOptions = Readonly<{
  environment?: Readonly<Record<string, string | undefined>>;
  write?: (message: string) => void;
}>;

export async function atomicStorageDriverSwitch(
  envFile: string,
  expectedSource: "filesystem" | "s3",
  target: "filesystem" | "s3",
): Promise<void> {
  const path = resolve(envFile);
  const current = await readFile(path, "utf8");
  const matches = [...current.matchAll(/^STORAGE_DRIVER=([^\r\n]*)$/gmu)];
  if (matches.length > 1) throw new Error("STORAGE_DRIVER occurs more than once");
  if (matches.length === 1 && matches[0]?.[1] !== expectedSource) {
    throw new Error("STORAGE_DRIVER changed during migration");
  }
  const next =
    matches.length === 0
      ? `${current}${current.endsWith("\n") || current.length === 0 ? "" : "\n"}STORAGE_DRIVER=${target}\n`
      : current.replace(/^STORAGE_DRIVER=[^\r\n]*$/mu, `STORAGE_DRIVER=${target}`);
  const temporary = resolve(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  await writeFile(temporary, next, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await rename(temporary, path);
}

function s3Target(
  args: readonly string[],
  environment: Readonly<Record<string, string | undefined>>,
): S3Storage {
  const stagingBucket = optionalValue(
    args,
    "--s3-staging-bucket",
    environment.S3_STAGING_BUCKET ?? "",
  );
  return new S3Storage({
    endpoint: optionalValue(args, "--s3-endpoint", environment.S3_ENDPOINT ?? ""),
    region: optionalValue(args, "--s3-region", environment.S3_REGION ?? "us-east-1"),
    forcePathStyle:
      optionalValue(args, "--s3-force-path-style", environment.S3_FORCE_PATH_STYLE ?? "false") ===
      "true",
    privateBucket: optionalValue(args, "--s3-private-bucket", environment.S3_PRIVATE_BUCKET ?? ""),
    publicBucket: optionalValue(args, "--s3-public-bucket", environment.S3_PUBLIC_BUCKET ?? ""),
    ...(stagingBucket.length === 0 ? {} : { stagingBucket }),
    credentials: {
      accessKeyId: optionalValue(args, "--s3-access-key", environment.S3_ACCESS_KEY_ID ?? ""),
      secretAccessKey: optionalValue(
        args,
        "--s3-secret-key",
        environment.S3_SECRET_ACCESS_KEY ?? "",
      ),
    },
  });
}

export async function runStorageMigration(
  argv: readonly string[],
  options: StorageCliOptions = {},
): Promise<void> {
  const environment = options.environment ?? {};
  await access(resolve(value(argv, "--maintenance-marker")));
  const sourceDriver = optionalValue(argv, "--source-driver", "filesystem");
  if (sourceDriver !== "filesystem" && sourceDriver !== "s3") {
    throw new Error("--source-driver must be filesystem or s3");
  }
  const manifestPath = resolve(value(argv, "--manifest"));
  const journalPath = resolve(optionalValue(argv, "--journal", `${manifestPath}.journal`));
  const driver = optionalValue(argv, "--target-driver", "filesystem");
  if (driver !== "filesystem" && driver !== "s3") {
    throw new Error("--target-driver must be filesystem or s3");
  }
  if (driver === sourceDriver) throw new Error("source and target storage drivers must differ");
  const source =
    sourceDriver === "filesystem"
      ? {
          privateRoot: resolve(value(argv, "--source-private")),
          stagingRoot: resolve(value(argv, "--source-staging")),
          publicRoot: resolve(value(argv, "--source-public")),
        }
      : undefined;
  const inventory =
    source === undefined
      ? assertInventoryManifest(JSON.parse(await readFile(manifestPath, "utf8")) as unknown)
      : await inventoryFilesystem(source);
  const storage =
    driver === "s3"
      ? s3Target(argv, environment)
      : new FilesystemStorage({
          privateRoot: resolve(value(argv, "--target-private")),
          stagingRoot: resolve(value(argv, "--target-staging")),
          publicRoot: resolve(value(argv, "--target-public")),
        });
  const sourceStorage = sourceDriver === "s3" ? s3Target(argv, environment) : undefined;
  await migrateStorageInventory(
    inventory,
    { private: storage, staging: storage, public: storage },
    {
      journalPath,
      ...(sourceStorage === undefined
        ? {}
        : { sources: { private: sourceStorage, staging: sourceStorage, public: sourceStorage } }),
    },
  );
  await verifyFilesystemInventory(inventory, {
    private: storage,
    staging: storage,
    public: storage,
  });
  if (source !== undefined) {
    await mkdir(dirname(manifestPath), { recursive: true });
    await writeFile(manifestPath, `${JSON.stringify(inventory, null, 2)}\n`, "utf8");
  }
  const switchEnv = optionalValue(argv, "--switch-env-file", "");
  if (switchEnv.length > 0) {
    await atomicStorageDriverSwitch(switchEnv, sourceDriver, driver);
  }
  (options.write ?? console.log)(
    `Migrated ${inventory.objects.length} objects with a resumable journal; manifest written to ${manifestPath}\n`,
  );
}
