import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { FilesystemStorage } from "../filesystem/filesystem-storage.js";
import { S3Storage } from "../s3/s3-storage.js";
import { assertInventoryManifest, verifyFilesystemInventory } from "./inventory.js";

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

export async function runStorageVerification(
  argv: readonly string[],
  options: StorageCliOptions = {},
): Promise<void> {
  const environment = options.environment ?? {};
  const manifest = assertInventoryManifest(
    JSON.parse(await readFile(resolve(value(argv, "--manifest")), "utf8")) as unknown,
  );
  const driver = optionalValue(argv, "--target-driver", "filesystem");
  const storage =
    driver === "s3"
      ? s3Target(argv, environment)
      : new FilesystemStorage({
          privateRoot: resolve(value(argv, "--target-private")),
          stagingRoot: resolve(value(argv, "--target-staging")),
          publicRoot: resolve(value(argv, "--target-public")),
        });
  if (driver !== "filesystem" && driver !== "s3") {
    throw new Error("--target-driver must be filesystem or s3");
  }
  await verifyFilesystemInventory(manifest, {
    private: storage,
    staging: storage,
    public: storage,
  });
  (options.write ?? console.log)(
    `Verified ${manifest.objects.length} objects against the ${driver} inventory target\n`,
  );
}
