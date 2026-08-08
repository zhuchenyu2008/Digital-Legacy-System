import { createHash, randomUUID } from "node:crypto";
import { createReadStream as createReadStreamFromFs } from "node:fs";
import { type FileHandle, link, lstat, mkdir, open, rm, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";

import type {
  ByteRange,
  ObjectMetadata,
  ObjectNamespace,
  ObjectStoragePort,
} from "@dls/application";

import { assertObjectKey } from "../object-key.js";
import {
  assertAbsoluteRoot,
  assertNoSymlinkEscape,
  ensureSafeRoot,
  resolveObjectPath,
} from "./safe-path.js";

type FilesystemStorageConfig = Readonly<{
  privateRoot: string;
  stagingRoot: string;
  publicRoot: string;
}>;

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

function assertExpectedSha256(value: string | undefined): void {
  if (value !== undefined && !SHA256_PATTERN.test(value)) {
    throw new Error("expectedSha256 must be a lowercase SHA-256 hex digest");
  }
}

async function syncDirectory(path: string): Promise<void> {
  try {
    const directory = await open(path, "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EPERM" && code !== "EINVAL" && code !== "ENOTSUP") throw error;
  }
}

async function digestFile(path: string): Promise<{ bytes: number; sha256: string }> {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStreamFromFs(path)) {
    const value = new Uint8Array(chunk);
    bytes += value.length;
    hash.update(value);
  }
  return { bytes, sha256: hash.digest("hex") };
}

async function writeAll(handle: FileHandle, chunk: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < chunk.length) {
    const result = await handle.write(chunk, offset, chunk.length - offset);
    offset += result.bytesWritten;
  }
}

export class FilesystemStorage implements ObjectStoragePort {
  private readonly roots: Readonly<Record<ObjectNamespace, string>>;

  constructor(config: FilesystemStorageConfig) {
    this.roots = Object.freeze({
      private: assertAbsoluteRoot(config.privateRoot),
      staging: assertAbsoluteRoot(config.stagingRoot),
      public: assertAbsoluteRoot(config.publicRoot),
    });
  }

  private root(namespace: ObjectNamespace): string {
    return this.roots[namespace];
  }

  private async target(
    namespace: ObjectNamespace,
    key: string,
  ): Promise<{ root: string; path: string }> {
    const root = await ensureSafeRoot(this.root(namespace));
    assertObjectKey(key);
    await assertNoSymlinkEscape(root, key);
    return { root, path: resolveObjectPath(root, key) };
  }

  async put(input: {
    namespace: ObjectNamespace;
    key: string;
    body: AsyncIterable<Uint8Array>;
    expectedBytes?: number;
    expectedSha256?: string;
  }): Promise<ObjectMetadata> {
    if (
      input.expectedBytes !== undefined &&
      (!Number.isSafeInteger(input.expectedBytes) || input.expectedBytes < 0)
    ) {
      throw new Error("expectedBytes must be a non-negative safe integer");
    }
    assertExpectedSha256(input.expectedSha256);
    const destination = await this.target(input.namespace, input.key);
    await mkdir(dirname(destination.path), { recursive: true, mode: 0o700 });
    await assertNoSymlinkEscape(destination.root, input.key);
    const temporary = join(dirname(destination.path), `.${randomUUID()}.uploading`);
    let handle: FileHandle | undefined;
    let installed = false;
    const hash = createHash("sha256");
    let bytes = 0;
    try {
      handle = await open(temporary, "wx", 0o600);
      for await (const chunk of input.body) {
        if (!(chunk instanceof Uint8Array))
          throw new TypeError("object body chunks must be Uint8Array");
        bytes += chunk.length;
        if (input.expectedBytes !== undefined && bytes > input.expectedBytes) {
          throw new Error("object body exceeds expectedBytes");
        }
        hash.update(chunk);
        await writeAll(handle, chunk);
      }
      if (input.expectedBytes !== undefined && bytes !== input.expectedBytes) {
        throw new Error("object body does not match expectedBytes");
      }
      const sha256 = hash.digest("hex");
      if (input.expectedSha256 !== undefined && sha256 !== input.expectedSha256) {
        throw new Error("object body does not match expectedSha256");
      }
      await handle.sync();
      await handle.close();
      handle = undefined;
      const metadata = { bytes, sha256, etag: sha256 } as const;
      try {
        await link(temporary, destination.path);
        await unlink(temporary);
        installed = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const existing = await this.head(input.namespace, input.key);
        if (existing === null || existing.sha256 !== sha256 || existing.bytes !== bytes) {
          throw new Error("destination object already exists with a different digest");
        }
        await unlink(temporary);
        installed = true;
      }
      await syncDirectory(dirname(destination.path));
      return metadata;
    } finally {
      if (handle !== undefined) await handle.close().catch(() => undefined);
      if (!installed) await rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  async head(namespace: ObjectNamespace, key: string): Promise<ObjectMetadata | null> {
    const destination = await this.target(namespace, key);
    let stats: Awaited<ReturnType<typeof lstat>>;
    try {
      stats = await lstat(destination.path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    if (stats.isSymbolicLink() || !stats.isFile())
      throw new Error("object path is not a regular file");
    const digest = await digestFile(destination.path);
    return { ...digest, etag: digest.sha256 };
  }

  async read(
    namespace: ObjectNamespace,
    key: string,
    range?: ByteRange,
  ): Promise<{
    body: AsyncIterable<Uint8Array>;
    bytes: number;
    totalBytes: number;
    etag: string;
  }> {
    const metadata = await this.head(namespace, key);
    if (metadata === null) throw new Error("object not found");
    const destination = await this.target(namespace, key);
    if (range === undefined) {
      return {
        body: (async function* () {
          for await (const chunk of createReadStreamFromFs(destination.path))
            yield new Uint8Array(chunk);
        })(),
        bytes: metadata.bytes,
        totalBytes: metadata.bytes,
        etag: metadata.etag,
      };
    }
    if (
      !Number.isSafeInteger(range.start) ||
      range.start < 0 ||
      range.start >= metadata.bytes ||
      (range.endInclusive !== undefined &&
        (!Number.isSafeInteger(range.endInclusive) ||
          range.endInclusive < range.start ||
          range.endInclusive >= metadata.bytes))
    ) {
      throw new Error("invalid object byte range");
    }
    const end = range.endInclusive ?? metadata.bytes - 1;
    return {
      body: (async function* () {
        for await (const chunk of createReadStreamFromFs(destination.path, {
          start: range.start,
          end,
        })) {
          yield new Uint8Array(chunk);
        }
      })(),
      bytes: end - range.start + 1,
      totalBytes: metadata.bytes,
      etag: metadata.etag,
    };
  }

  async promote(input: {
    from: "staging";
    to: "private" | "public";
    sourceKey: string;
    destinationKey: string;
    expectedSha256: string;
  }): Promise<void> {
    assertExpectedSha256(input.expectedSha256);
    const source = await this.head("staging", input.sourceKey);
    if (source === null) throw new Error("staging source object not found");
    if (source.sha256 !== input.expectedSha256) throw new Error("staging source digest mismatch");
    const content = await this.read("staging", input.sourceKey);
    await this.put({
      namespace: input.to,
      key: input.destinationKey,
      body: content.body,
      expectedBytes: source.bytes,
      expectedSha256: input.expectedSha256,
    });
    const destination = await this.head(input.to, input.destinationKey);
    if (destination === null || destination.sha256 !== input.expectedSha256) {
      throw new Error("promoted object failed verification");
    }
    await this.delete("staging", input.sourceKey);
  }

  async delete(namespace: "private" | "staging", key: string): Promise<void> {
    const destination = await this.target(namespace, key);
    try {
      await unlink(destination.path);
      await syncDirectory(dirname(destination.path));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}
