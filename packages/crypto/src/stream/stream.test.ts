import { readFileSync } from "node:fs";
import { ReadableStream } from "node:stream/web";
import { describe, expect, it } from "vitest";

import { decodeBase64Url } from "../protocol/base64url.js";
import { decryptStream, type StreamContext, type StreamManifest } from "./decrypt-stream.js";
import { encryptStream } from "./encrypt-stream.js";
import {
  encodeFileHeader,
  FILE_HEADER_BYTES,
  FRAME_LENGTH_BYTES,
  MAX_PLAINTEXT_FRAME_BYTES,
  parseFileHeader,
} from "./file-format.js";

const streamVector = JSON.parse(
  readFileSync(new URL("../../vectors/secretstream-v1.json", import.meta.url), "utf8"),
) as {
  testOnly: boolean;
  version: number;
  secretstreamHeader: string;
  fileHeader: string;
};

const context: StreamContext = {
  vaultId: "vault-stream-test",
  packageId: "package-stream-test",
  packageVersion: 3,
};
const key = Uint8Array.from({ length: 32 }, (_, index) => index + 1);

function concatenate(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

async function* sourceChunks(chunks: readonly Uint8Array[]): AsyncIterable<Uint8Array> {
  for (const chunk of chunks) yield new Uint8Array(chunk);
}

async function encrypt(chunks: readonly Uint8Array[], inputKey = key, inputContext = context) {
  const output: Uint8Array[] = [];
  const manifest = await encryptStream({
    key: inputKey,
    context: inputContext,
    chunks: sourceChunks(chunks),
    onChunk: (chunk) => {
      output.push(new Uint8Array(chunk));
    },
  });
  return { bytes: concatenate(output), manifest };
}

async function decrypt(
  bytes: Uint8Array,
  inputKey = key,
  inputContext = context,
  boundaries: readonly number[] = [bytes.length],
): Promise<{ bytes: Uint8Array; manifest: StreamManifest }> {
  const output: Uint8Array[] = [];
  let offset = 0;
  const chunks = boundaries.map((size) => {
    const chunk = bytes.slice(offset, offset + size);
    offset += size;
    return chunk;
  });
  if (offset < bytes.length) chunks.push(bytes.slice(offset));
  const manifest = await decryptStream({
    key: inputKey,
    context: inputContext,
    chunks: sourceChunks(chunks),
    onChunk: (chunk) => {
      output.push(new Uint8Array(chunk));
    },
  });
  return { bytes: concatenate(output), manifest };
}

describe("authenticated DLSF secretstream v1", () => {
  it("matches the committed non-secret fixed-header vector", () => {
    expect(streamVector.testOnly).toBe(true);
    expect(streamVector.version).toBe(1);
    const secretstreamHeader = decodeBase64Url(streamVector.secretstreamHeader);
    const fileHeader = decodeBase64Url(streamVector.fileHeader);
    expect(encodeFileHeader(secretstreamHeader)).toEqual(fileHeader);
    expect(parseFileHeader(fileHeader)).toEqual(secretstreamHeader);
  });

  it.each([
    ["empty", []],
    ["one byte", [Uint8Array.of(7)]],
    ["exact frame", [new Uint8Array(MAX_PLAINTEXT_FRAME_BYTES)]],
    ["multi-frame", [new Uint8Array(MAX_PLAINTEXT_FRAME_BYTES + 17)]],
  ])("round trips %s input", async (_name, chunks) => {
    const encrypted = await encrypt(chunks);
    const decrypted = await decrypt(encrypted.bytes, key, context, [1, 2, 3, 5, 8, 13]);
    expect(decrypted.bytes).toEqual(concatenate(chunks));
    expect(decrypted.manifest.plaintextBytes).toBe(concatenate(chunks).length);
    expect(encrypted.manifest.ciphertextBytes).toBe(encrypted.bytes.length);
    expect(decodeBase64Url(decrypted.manifest.plaintextSha256)).toHaveLength(32);
  });

  it("handles arbitrary source and ciphertext chunk boundaries", async () => {
    const plaintext = Uint8Array.from({ length: 10_000 }, (_, index) => index & 0xff);
    const encrypted = await encrypt([
      plaintext.slice(0, 1),
      plaintext.slice(1, 17),
      plaintext.slice(17, 2049),
      plaintext.slice(2049),
    ]);
    const decrypted = await decrypt(
      encrypted.bytes,
      key,
      context,
      Array.from({ length: encrypted.bytes.length }, (_, index) => (index % 11) + 1),
    );
    expect(decrypted.bytes).toEqual(plaintext);
  });

  it("accepts a Web ReadableStream as a browser-compatible chunk source", async () => {
    const encrypted = await encrypt([
      Uint8Array.from({ length: 4097 }, (_, index) => index & 0xff),
    ]);
    const chunks = [
      encrypted.bytes.slice(0, 7),
      encrypted.bytes.slice(7, 111),
      encrypted.bytes.slice(111),
    ];
    const readable = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    });
    const output: Uint8Array[] = [];
    await decryptStream({
      key,
      context,
      chunks: readable,
      onChunk: (chunk) => {
        output.push(new Uint8Array(chunk));
      },
    });
    expect(concatenate(output)).toEqual(
      Uint8Array.from({ length: 4097 }, (_, index) => index & 0xff),
    );
  });

  it("rejects wrong key or package AAD", async () => {
    const encrypted = await encrypt([Uint8Array.from([1, 2, 3])]);
    await expect(
      decrypt(
        encrypted.bytes,
        Uint8Array.from(key, (value) => value ^ 1),
      ),
    ).rejects.toThrow();
    await expect(
      decrypt(encrypted.bytes, key, { ...context, packageVersion: 4 }),
    ).rejects.toThrow();
  });

  it("rejects tamper, truncation, frame reordering, duplication, and append", async () => {
    const encrypted = await encrypt([new Uint8Array(MAX_PLAINTEXT_FRAME_BYTES + 10)]);
    const tampered = new Uint8Array(encrypted.bytes);
    const tamperedIndex = FILE_HEADER_BYTES + FRAME_LENGTH_BYTES + 2;
    tampered[tamperedIndex] = (tampered[tamperedIndex] ?? 0) ^ 1;
    await expect(decrypt(tampered)).rejects.toThrow();
    await expect(decrypt(encrypted.bytes.slice(0, -1))).rejects.toThrow();

    const firstLength = new DataView(
      encrypted.bytes.buffer,
      encrypted.bytes.byteOffset + FILE_HEADER_BYTES,
      FRAME_LENGTH_BYTES,
    ).getUint32(0, false);
    const firstStart = FILE_HEADER_BYTES + FRAME_LENGTH_BYTES;
    const secondLengthStart = firstStart + firstLength + FRAME_LENGTH_BYTES;
    const secondLength = new DataView(
      encrypted.bytes.buffer,
      encrypted.bytes.byteOffset + secondLengthStart,
      FRAME_LENGTH_BYTES,
    ).getUint32(0, false);
    const secondStart = secondLengthStart + FRAME_LENGTH_BYTES;
    const header = encrypted.bytes.slice(0, FILE_HEADER_BYTES);
    const firstFrame = encrypted.bytes.slice(FILE_HEADER_BYTES, firstStart + firstLength);
    const secondFrame = encrypted.bytes.slice(secondLengthStart, secondStart + secondLength);
    await expect(decrypt(concatenate([header, secondFrame, firstFrame]))).rejects.toThrow();
    await expect(
      decrypt(concatenate([header, firstFrame, firstFrame, secondFrame])),
    ).rejects.toThrow();
    await expect(decrypt(concatenate([encrypted.bytes, Uint8Array.of(0)]))).rejects.toThrow();
  });

  it("rejects an oversized frame before secretstream invocation", async () => {
    const encrypted = await encrypt([Uint8Array.of(1)]);
    const oversized = new Uint8Array(encrypted.bytes);
    new DataView(oversized.buffer, oversized.byteOffset + FILE_HEADER_BYTES, 4).setUint32(
      0,
      MAX_PLAINTEXT_FRAME_BYTES + 18,
      false,
    );
    await expect(decrypt(oversized)).rejects.toThrow(/frame/i);
  });

  it("does not accept a stream without a FINAL frame", async () => {
    const encrypted = await encrypt([Uint8Array.of(1)]);
    const withoutFinal = encrypted.bytes.slice(0, -1);
    await expect(decrypt(withoutFinal)).rejects.toThrow();
  });
});
