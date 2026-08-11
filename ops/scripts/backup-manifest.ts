import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export type BackupDigest = Readonly<{
  name: string;
  bytes: number;
  sha256: string;
}>;

export type BackupObject = Readonly<{
  path: string;
  bytes: number;
  sha256: string;
}>;

export type BackupManifest = Readonly<{
  version: 1;
  createdAt: string;
  project: string;
  artifacts: readonly BackupDigest[];
  objects: readonly BackupObject[];
}>;

type CreateBackupManifestInput = Readonly<{
  backupDirectory: string;
  objectRoot: string;
  project: string;
  createdAt?: string;
}>;

const artifactNames = [
  "database-state.json",
  "database.dump",
  "objects.tar",
  "runtime.json",
] as const;
const digestPattern = /^[0-9a-f]{64}$/u;
const tarBlockBytes = 512;
const tarTextDecoder = new TextDecoder("utf-8", { fatal: true });

function tarText(archive: Uint8Array, offset: number, length: number, field: string): string {
  const bytes = archive.subarray(offset, offset + length);
  const terminator = bytes.indexOf(0);
  const value = terminator < 0 ? bytes : bytes.subarray(0, terminator);
  try {
    return tarTextDecoder.decode(value);
  } catch (error) {
    throw new Error(`object archive ${field} is not valid UTF-8`, { cause: error });
  }
}

function tarOctal(archive: Uint8Array, offset: number, length: number, field: string): number {
  const bytes = archive.subarray(offset, offset + length);
  if ((bytes[0] ?? 0) >= 0x80) throw new Error(`object archive ${field} uses base-256`);
  const value = tarTextDecoder.decode(bytes).replaceAll("\0", "").trim();
  if (!/^[0-7]+$/u.test(value)) throw new Error(`object archive ${field} is invalid`);
  const parsed = Number.parseInt(value, 8);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`object archive ${field} is outside the safe integer range`);
  }
  return parsed;
}

function assertTarChecksum(archive: Uint8Array, offset: number): void {
  const expected = tarOctal(archive, offset + 148, 8, "checksum");
  let actual = 0;
  for (let index = 0; index < tarBlockBytes; index += 1) {
    actual += index >= 148 && index < 156 ? 0x20 : (archive[offset + index] ?? 0);
  }
  if (actual !== expected) throw new Error("object archive header checksum is invalid");
}

function safeTarPath(value: string, type: "file" | "directory"): string {
  if (
    value.length === 0 ||
    value.startsWith("/") ||
    value.startsWith("\\") ||
    /^[A-Za-z]:/u.test(value) ||
    value.includes("\\") ||
    /[\p{Cc}\p{Cf}]/u.test(value)
  ) {
    throw new Error("object archive contains an unsafe path");
  }
  const segments = value.split("/");
  if (segments.some((segment) => segment === "..")) {
    throw new Error("object archive contains an unsafe path");
  }
  const normalized = segments.filter((segment) => segment !== "." && segment !== "").join("/");
  if (normalized.length === 0 && type !== "directory") {
    throw new Error("object archive file path is empty");
  }
  return normalized;
}

export function validateTarArchive(archive: Uint8Array): void {
  if (!(archive instanceof Uint8Array) || archive.length % tarBlockBytes !== 0) {
    throw new Error("object archive length is invalid");
  }
  const paths = new Set<string>();
  let offset = 0;
  while (offset < archive.length) {
    const header = archive.subarray(offset, offset + tarBlockBytes);
    if (header.every((byte) => byte === 0)) {
      if (
        archive.length - offset < tarBlockBytes * 2 ||
        !archive.subarray(offset).every((byte) => byte === 0)
      ) {
        throw new Error("object archive terminator is invalid");
      }
      return;
    }
    assertTarChecksum(archive, offset);
    const name = tarText(archive, offset, 100, "name");
    const prefix = tarText(archive, offset + 345, 155, "prefix");
    const typeFlag = archive[offset + 156] ?? 0;
    const type =
      typeFlag === 0 || typeFlag === 0x30 ? "file" : typeFlag === 0x35 ? "directory" : null;
    if (type === null) {
      throw new Error("object archive links and special entries are not allowed");
    }
    const path = safeTarPath(prefix.length === 0 ? name : `${prefix}/${name}`, type);
    if (path.length > 0) {
      if (paths.has(path)) throw new Error(`object archive path is duplicated: ${path}`);
      paths.add(path);
    }
    const size = tarOctal(archive, offset + 124, 12, "entry size");
    if (type === "directory" && size !== 0) {
      throw new Error("object archive directory has a nonzero size");
    }
    const paddedSize = Math.ceil(size / tarBlockBytes) * tarBlockBytes;
    const nextOffset = offset + tarBlockBytes + paddedSize;
    if (!Number.isSafeInteger(nextOffset) || nextOffset > archive.length) {
      throw new Error("object archive entry exceeds the archive boundary");
    }
    offset = nextOffset;
  }
  throw new Error("object archive is missing its terminator");
}

export async function validateTarArchiveFile(path: string): Promise<void> {
  validateTarArchive(await readFile(resolve(path)));
}

async function digestFile(path: string): Promise<Readonly<{ bytes: number; sha256: string }>> {
  const hash = createHash("sha256");
  let bytes = 0;
  await new Promise<void>((resolveDigest, rejectDigest) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      hash.update(chunk);
    });
    stream.once("error", rejectDigest);
    stream.once("end", resolveDigest);
  });
  return { bytes, sha256: hash.digest("hex") };
}

function portablePath(root: string, path: string): string {
  const value = relative(root, path).split(sep).join(posix.sep);
  if (value.length === 0 || value === ".." || value.startsWith("../") || posix.isAbsolute(value)) {
    throw new Error(`object path escapes the configured root: ${path}`);
  }
  return value;
}

async function inventoryObjects(objectRoot: string): Promise<BackupObject[]> {
  const root = resolve(objectRoot);
  const output: BackupObject[] = [];

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const path = resolve(directory, entry.name);
      const portable = portablePath(root, path);
      if (portable === "MAINTENANCE") continue;
      const metadata = await lstat(path);
      if (metadata.isSymbolicLink()) {
        throw new Error(`symbolic links are not allowed in object storage: ${portable}`);
      }
      if (metadata.isDirectory()) {
        await visit(path);
        continue;
      }
      if (!metadata.isFile()) {
        throw new Error(`unsupported object storage entry: ${portable}`);
      }
      output.push({ path: portable, ...(await digestFile(path)) });
    }
  }

  await visit(root);
  return output.sort((left, right) => left.path.localeCompare(right.path, "en"));
}

function assertManifest(value: unknown): asserts value is BackupManifest {
  if (value === null || typeof value !== "object") throw new Error("backup manifest is invalid");
  const manifest = value as Partial<BackupManifest>;
  if (
    manifest.version !== 1 ||
    typeof manifest.createdAt !== "string" ||
    !Number.isFinite(Date.parse(manifest.createdAt)) ||
    typeof manifest.project !== "string" ||
    !/^[A-Za-z0-9._-]+$/u.test(manifest.project) ||
    !Array.isArray(manifest.artifacts) ||
    !Array.isArray(manifest.objects)
  ) {
    throw new Error("backup manifest is invalid");
  }
  for (const artifact of manifest.artifacts) {
    if (
      artifact === null ||
      typeof artifact !== "object" ||
      !artifactNames.includes((artifact as BackupDigest).name as (typeof artifactNames)[number]) ||
      !Number.isSafeInteger((artifact as BackupDigest).bytes) ||
      (artifact as BackupDigest).bytes < 0 ||
      !digestPattern.test((artifact as BackupDigest).sha256)
    ) {
      throw new Error("backup artifact manifest entry is invalid");
    }
  }
  for (const object of manifest.objects) {
    const entry = object as BackupObject;
    if (
      object === null ||
      typeof object !== "object" ||
      entry.path.length === 0 ||
      posix.isAbsolute(entry.path) ||
      entry.path === ".." ||
      entry.path.startsWith("../") ||
      entry.path.includes("\\") ||
      !Number.isSafeInteger(entry.bytes) ||
      entry.bytes < 0 ||
      !digestPattern.test(entry.sha256)
    ) {
      throw new Error("backup object manifest entry is invalid");
    }
  }
}

export async function createBackupManifest(
  input: CreateBackupManifestInput,
): Promise<BackupManifest> {
  if (!/^[A-Za-z0-9._-]+$/u.test(input.project)) throw new Error("backup project name is invalid");
  const backupDirectory = resolve(input.backupDirectory);
  const artifacts = await Promise.all(
    artifactNames.map(async (name) => ({
      name,
      ...(await digestFile(resolve(backupDirectory, name))),
    })),
  );
  const manifest: BackupManifest = Object.freeze({
    version: 1,
    createdAt: input.createdAt ?? new Date().toISOString(),
    project: input.project,
    artifacts,
    objects: await inventoryObjects(input.objectRoot),
  });
  await writeFile(
    resolve(backupDirectory, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  return manifest;
}

async function readManifest(backupDirectory: string): Promise<BackupManifest> {
  const manifest = JSON.parse(
    await readFile(resolve(backupDirectory, "manifest.json"), "utf8"),
  ) as unknown;
  assertManifest(manifest);
  if (
    manifest.artifacts
      .map((artifact) => artifact.name)
      .sort()
      .join(",") !== [...artifactNames].sort().join(",")
  ) {
    throw new Error("backup manifest does not contain the exact required artifacts");
  }
  return manifest;
}

export async function verifyBackupArtifacts(backupDirectory: string): Promise<BackupManifest> {
  const root = resolve(backupDirectory);
  const manifest = await readManifest(root);
  for (const expected of manifest.artifacts) {
    const actual = await digestFile(resolve(root, basename(expected.name)));
    if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256) {
      throw new Error(`backup artifact digest or size mismatch: ${expected.name}`);
    }
  }
  return manifest;
}

export async function verifyRestoredObjects(
  backupDirectory: string,
  objectRoot: string,
): Promise<Readonly<{ objects: number; bytes: number }>> {
  const manifest = await verifyBackupArtifacts(backupDirectory);
  const actual = await inventoryObjects(objectRoot);
  if (actual.length !== manifest.objects.length) {
    throw new Error(
      `restored object count mismatch: expected ${manifest.objects.length}, got ${actual.length}`,
    );
  }
  for (let index = 0; index < manifest.objects.length; index += 1) {
    const expected = manifest.objects[index];
    const found = actual[index];
    if (
      expected === undefined ||
      found === undefined ||
      found.path !== expected.path ||
      found.bytes !== expected.bytes ||
      found.sha256 !== expected.sha256
    ) {
      throw new Error(
        `restored object path, size, or digest mismatch at ${expected?.path ?? index}`,
      );
    }
  }
  return {
    objects: actual.length,
    bytes: actual.reduce((total, object) => total + object.bytes, 0),
  };
}

function option(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? undefined : process.argv[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`${name} is required`);
  return value;
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === "create") {
    console.log(
      JSON.stringify(
        await createBackupManifest({
          backupDirectory: option("--backup"),
          objectRoot: option("--objects"),
          project: option("--project"),
        }),
      ),
    );
    return;
  }
  if (command === "verify-artifacts") {
    console.log(JSON.stringify(await verifyBackupArtifacts(option("--backup"))));
    return;
  }
  if (command === "verify-objects") {
    console.log(
      JSON.stringify(await verifyRestoredObjects(option("--backup"), option("--objects"))),
    );
    return;
  }
  if (command === "validate-tar") {
    await validateTarArchiveFile(option("--archive"));
    console.log(JSON.stringify({ valid: true }));
    return;
  }
  throw new Error(
    "usage: backup-manifest.ts <create|verify-artifacts|verify-objects|validate-tar> ...",
  );
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
