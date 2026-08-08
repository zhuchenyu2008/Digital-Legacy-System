import { createHash } from "node:crypto";

import type {
  ArchiveEntryMetadata,
  ArchiveInspection,
  ArchiveInspectorPort,
  ArchivePolicy,
} from "@dls/application";
import { type Entry, fromBufferPromise, type ZipFile } from "yauzl";

import { resolveZipPolicy, ZipPolicyError } from "./zip-policy.js";

type InputArchive = Uint8Array | AsyncIterable<Uint8Array>;
type Range = Readonly<{ start: number; end: number; path: string }>;

const WINDOWS_DEVICES = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/iu;
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

function fail(code: string, message: string): never {
  throw new ZipPolicyError(code, message);
}

async function readArchive(input: InputArchive, maxBytes: number): Promise<Buffer> {
  if (input instanceof Uint8Array) {
    if (input.byteLength > maxBytes) fail("archive-bytes", "archive exceeds configured byte limit");
    return Buffer.from(input);
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of input) {
    if (!(chunk instanceof Uint8Array)) throw new TypeError("archive chunks must be Uint8Array");
    bytes += chunk.length;
    if (bytes > maxBytes) fail("archive-bytes", "archive exceeds configured byte limit");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks, bytes);
}

function checkedAdd(left: number, right: number, label: string): number {
  const value = left + right;
  if (!Number.isSafeInteger(value) || value < left)
    fail("zip64", `${label} exceeds safe integer bounds`);
  return value;
}

function rawFileName(entry: Entry): string {
  if ((entry.generalPurposeBitFlag & 0x800) !== 0) {
    try {
      return UTF8_DECODER.decode(entry.fileNameRaw);
    } catch {
      fail("utf8", "ZIP filename is not valid UTF-8");
    }
  }
  return entry.fileName;
}

function normalizedPath(entry: Entry): string {
  const path = rawFileName(entry).normalize("NFC");
  if (path.length === 0 || path.includes("\0"))
    fail("path", "ZIP filename is empty or contains NUL");
  if (
    path.includes("\\") ||
    path.startsWith("/") ||
    /^\\\\/u.test(path) ||
    /^[A-Za-z]:/u.test(path)
  ) {
    fail("path", `ZIP filename is not a safe relative path: ${path}`);
  }
  const directory = path.endsWith("/");
  const pathWithoutDirectoryMarker = directory ? path.slice(0, -1) : path;
  const segments = pathWithoutDirectoryMarker.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    fail("path", `ZIP filename contains an unsafe path segment: ${path}`);
  }
  if (segments.some((segment) => WINDOWS_DEVICES.test(segment.replace(/[ .]+$/u, "")))) {
    fail("path", `ZIP filename uses a Windows device name: ${path}`);
  }
  return directory ? `${pathWithoutDirectoryMarker}/` : pathWithoutDirectoryMarker;
}

function isSymlink(entry: Entry): boolean {
  const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff;
  return ((entry.versionMadeBy >>> 8) & 0xff) === 3 && (unixMode & 0xf000) === 0xa000;
}

function validateEntryNumbers(entry: Entry, policy: ArchivePolicy): void {
  for (const [name, value] of [
    ["compressed size", entry.compressedSize],
    ["uncompressed size", entry.uncompressedSize],
    ["local header offset", entry.relativeOffsetOfLocalHeader],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) fail("zip64", `invalid ${name}`);
  }
  if (entry.uncompressedSize > policy.maxUncompressedBytes) {
    fail("uncompressed-bytes", "ZIP entry exceeds the uncompressed size budget");
  }
  if (entry.uncompressedSize > 0) {
    if (
      entry.compressedSize === 0 ||
      entry.uncompressedSize / entry.compressedSize > policy.maxCompressionRatio
    ) {
      fail("compression-ratio", "ZIP entry exceeds the compression ratio limit");
    }
  }
}

function validateLocalHeader(
  entry: Entry,
  local: {
    fileDataStart: number;
    fileName: Buffer;
    compressionMethod: number;
    generalPurposeBitFlag: number;
    crc32: number;
    compressedSize: number;
    uncompressedSize: number;
  },
): void {
  if (!local.fileName.equals(entry.fileNameRaw))
    fail("header", "local and central filename headers differ");
  if (
    local.compressionMethod !== entry.compressionMethod ||
    local.generalPurposeBitFlag !== entry.generalPurposeBitFlag
  ) {
    fail("header", "local and central compression headers differ");
  }
  if (
    (entry.generalPurposeBitFlag & 0x8) === 0 &&
    (local.crc32 !== entry.crc32 ||
      local.compressedSize !== entry.compressedSize ||
      local.uncompressedSize !== entry.uncompressedSize)
  ) {
    fail("header", "local and central size or CRC headers differ");
  }
}

function entryMetadata(entry: Entry, path: string): ArchiveEntryMetadata {
  return {
    path,
    bytes: entry.uncompressedSize,
    compressedBytes: entry.compressedSize,
    directory: path.endsWith("/"),
    encrypted: entry.isEncrypted(),
    symlink: isSymlink(entry),
  };
}

async function readWill(
  zip: ZipFile,
  entry: Entry,
  maxBytes: number,
): Promise<{ bytes: Uint8Array; sha256: string }> {
  const stream = await zip.openReadStreamPromise(entry);
  const chunks: Uint8Array[] = [];
  const hash = createHash("sha256");
  let total = 0;
  for await (const chunk of stream) {
    const value = new Uint8Array(chunk);
    total = checkedAdd(total, value.length, "will bytes");
    if (total > maxBytes) fail("will-bytes", "will.md exceeds configured size limit");
    hash.update(value);
    chunks.push(value);
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return { bytes: output, sha256: hash.digest("hex") };
}

export async function inspectZip(
  input: InputArchive,
  overrides?: Partial<ArchivePolicy>,
): Promise<ArchiveInspection> {
  const policy = resolveZipPolicy(overrides);
  const archive = await readArchive(input, policy.maxArchiveBytes);
  let zip: ZipFile | undefined;
  try {
    zip = await fromBufferPromise(archive, {
      autoClose: false,
      decodeStrings: true,
      lazyEntries: true,
      strictFileNames: false,
      validateEntrySizes: true,
    });
  } catch (error) {
    throw new ZipPolicyError("invalid-zip", `invalid ZIP archive: ${String(error)}`);
  }

  const entries: ArchiveEntryMetadata[] = [];
  const ranges: Range[] = [];
  const seen = new Set<string>();
  const seenCaseFolded = new Map<string, string>();
  let totalUncompressed = 0;
  let will: { path: "will.md"; bytes: Uint8Array; sha256: string } | undefined;
  try {
    for await (const entry of zip.eachEntry()) {
      if (entries.length >= policy.maxEntries) fail("entries", "ZIP contains too many entries");
      validateEntryNumbers(entry, policy);
      const path = normalizedPath(entry);
      if (seen.has(path)) fail("collision", `ZIP contains duplicate normalized path: ${path}`);
      seen.add(path);
      const caseFolded = path.toLocaleLowerCase("en-US");
      const previousCaseFolded = seenCaseFolded.get(caseFolded);
      if (previousCaseFolded !== undefined && previousCaseFolded !== path) {
        fail("collision", `ZIP contains case-colliding paths: ${previousCaseFolded} and ${path}`);
      }
      seenCaseFolded.set(caseFolded, path);
      if (entry.isEncrypted()) fail("encrypted", `ZIP entry is encrypted: ${path}`);
      if (isSymlink(entry)) fail("symlink", `ZIP entry is a symlink: ${path}`);
      totalUncompressed = checkedAdd(
        totalUncompressed,
        entry.uncompressedSize,
        "ZIP uncompressed budget",
      );
      if (totalUncompressed > policy.maxUncompressedBytes)
        fail("uncompressed-bytes", "ZIP exceeds the uncompressed size budget");

      const local = await zip.readLocalFileHeaderPromise(entry);
      validateLocalHeader(entry, local);
      const dataEnd = checkedAdd(local.fileDataStart, entry.compressedSize, "ZIP data range");
      if (dataEnd > archive.length) fail("range", `ZIP entry extends past the archive: ${path}`);
      ranges.push({ start: local.fileDataStart, end: dataEnd, path });
      const metadata = entryMetadata(entry, path);
      entries.push(metadata);
      if (path === "will.md") {
        if (entry.uncompressedSize > policy.maxWillBytes)
          fail("will-bytes", "will.md exceeds configured size limit");
        will = { path: "will.md", ...(await readWill(zip, entry, policy.maxWillBytes)) };
      }
    }
  } catch (error) {
    if (error instanceof ZipPolicyError) throw error;
    throw new ZipPolicyError("invalid-zip", `invalid ZIP entry: ${String(error)}`);
  } finally {
    zip.close();
  }

  ranges.sort((left, right) => left.start - right.start);
  for (let index = 1; index < ranges.length; index += 1) {
    const previous = ranges[index - 1];
    const current = ranges[index];
    if (previous !== undefined && current !== undefined && current.start < previous.end) {
      fail("overlap", `ZIP entry data overlaps: ${previous.path} and ${current.path}`);
    }
  }
  if (will === undefined) fail("will-missing", "ZIP must contain exactly one root will.md");
  const willBytes = will.bytes;
  return {
    archiveBytes: archive.length,
    entries,
    will: {
      path: "will.md",
      bytes: willBytes.length,
      sha256: will.sha256,
      body: (async function* () {
        yield willBytes;
      })(),
    },
  };
}

export class ZipInspector implements ArchiveInspectorPort {
  inspect(input: InputArchive, policy?: Partial<ArchivePolicy>): Promise<ArchiveInspection> {
    return inspectZip(input, policy);
  }
}

export { DEFAULT_ZIP_POLICY, ZipPolicyError } from "./zip-policy.js";
