import sodium from "libsodium-wrappers-sumo";
import { assertKeyBytes } from "../keys/key-material.js";
import { encodeBase64Url } from "../protocol/base64url.js";
import {
  createSha256Accumulator,
  FILE_HEADER_BYTES,
  frameAdditionalData,
  MAX_CIPHERTEXT_FRAME_BYTES,
  parseFileHeader,
  parseFrameLength,
  type StreamContext,
  type StreamManifest,
} from "./file-format.js";

export type { StreamContext, StreamManifest } from "./file-format.js";

type StreamSink = (chunk: Uint8Array) => void | Promise<void>;

export type DecryptStreamInput = Readonly<{
  key: Uint8Array;
  context: StreamContext;
  chunks: AsyncIterable<Uint8Array>;
  onChunk: StreamSink;
}>;

class ByteQueue {
  private readonly chunks: Uint8Array[] = [];
  private availableBytes = 0;

  get length(): number {
    return this.availableBytes;
  }

  append(value: Uint8Array): void {
    if (value.length === 0) return;
    this.chunks.push(new Uint8Array(value));
    this.availableBytes += value.length;
  }

  take(length: number): Uint8Array {
    if (!Number.isSafeInteger(length) || length < 0 || length > this.availableBytes) {
      throw new Error("DLSF parser requested unavailable bytes");
    }
    const output = new Uint8Array(length);
    let written = 0;
    while (written < length) {
      const first = this.chunks[0];
      if (first === undefined) throw new Error("DLSF parser queue underflow");
      const count = Math.min(length - written, first.length);
      output.set(first.subarray(0, count), written);
      written += count;
      this.availableBytes -= count;
      if (count === first.length) {
        this.chunks.shift();
      } else {
        this.chunks[0] = first.subarray(count);
      }
    }
    return output;
  }
}

export async function decryptStream(input: DecryptStreamInput): Promise<StreamManifest> {
  const key = assertKeyBytes(input.key, "key");
  await sodium.ready;
  const queue = new ByteQueue();
  const plaintextHash = createSha256Accumulator();
  const ciphertextHash = createSha256Accumulator();
  let state: ReturnType<typeof sodium.crypto_secretstream_xchacha20poly1305_init_pull> | undefined;
  let headerParsed = false;
  let expectedFrameLength: number | undefined;
  let sequence = 0;
  let frameCount = 0;
  let plaintextBytes = 0;
  let ciphertextBytes = 0;
  let finalSeen = false;
  let streamHeader: string | undefined;

  const processQueue = async (): Promise<void> => {
    while (true) {
      if (!headerParsed) {
        if (queue.length < FILE_HEADER_BYTES) return;
        const header = queue.take(FILE_HEADER_BYTES);
        const secretstreamHeader = parseFileHeader(header);
        streamHeader = encodeBase64Url(secretstreamHeader);
        header.fill(0);
        state = sodium.crypto_secretstream_xchacha20poly1305_init_pull(secretstreamHeader, key);
        secretstreamHeader.fill(0);
        headerParsed = true;
      }
      if (finalSeen) {
        if (queue.length !== 0) throw new Error("DLSF bytes follow FINAL frame");
        return;
      }
      if (expectedFrameLength === undefined) {
        if (queue.length < 4) return;
        expectedFrameLength = parseFrameLength(queue.take(4));
        if (expectedFrameLength > MAX_CIPHERTEXT_FRAME_BYTES) {
          throw new Error("DLSF frame exceeds configured limit");
        }
      }
      if (queue.length < expectedFrameLength) return;
      const ciphertext = queue.take(expectedFrameLength);
      const aad = frameAdditionalData(input.context, sequence);
      let opened: { message: Uint8Array; tag: number } | false;
      try {
        if (state === undefined) throw new Error("DLSF secretstream state is not initialized");
        opened = sodium.crypto_secretstream_xchacha20poly1305_pull(state, ciphertext, aad);
      } finally {
        aad.fill(0);
        ciphertext.fill(0);
      }
      if (opened === false) throw new Error("DLSF authentication failed");
      if (
        opened.tag !== sodium.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE &&
        opened.tag !== sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL
      ) {
        opened.message.fill(0);
        throw new Error("DLSF frame has an unsupported tag");
      }
      const plaintext = new Uint8Array(opened.message);
      try {
        plaintextHash.update(plaintext);
        plaintextBytes += plaintext.length;
        await input.onChunk(new Uint8Array(plaintext));
      } finally {
        plaintext.fill(0);
        opened.message.fill(0);
      }
      frameCount += 1;
      sequence += 1;
      if (opened.tag === sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL) {
        finalSeen = true;
        if (queue.length !== 0) throw new Error("DLSF bytes follow FINAL frame");
      }
      expectedFrameLength = undefined;
    }
  };

  try {
    for await (const incoming of input.chunks) {
      if (!(incoming instanceof Uint8Array))
        throw new TypeError("stream chunks must be Uint8Array");
      if (finalSeen && incoming.length !== 0) throw new Error("DLSF bytes follow FINAL frame");
      ciphertextHash.update(incoming);
      ciphertextBytes += incoming.length;
      queue.append(incoming);
      await processQueue();
    }
    await processQueue();
    if (!headerParsed) throw new Error("DLSF stream is truncated before its header");
    if (expectedFrameLength !== undefined || queue.length !== 0) {
      throw new Error("DLSF stream is truncated inside a frame");
    }
    if (!finalSeen) throw new Error("DLSF stream has no FINAL frame");
    return {
      version: 1,
      algorithm: "secretstream-xchacha20poly1305",
      streamHeader: streamHeader ?? "",
      plaintextBytes,
      ciphertextBytes,
      plaintextSha256: encodeBase64Url(plaintextHash.final()),
      ciphertextSha256: encodeBase64Url(ciphertextHash.final()),
      frameCount,
    };
  } finally {
    key.fill(0);
  }
}
