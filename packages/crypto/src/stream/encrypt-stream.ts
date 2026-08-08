import sodium from "libsodium-wrappers-sumo";
import { assertKeyBytes } from "../keys/key-material.js";
import { encodeBase64Url } from "../protocol/base64url.js";
import {
  createSha256Accumulator,
  encodeFileHeader,
  encodeFrameLength,
  frameAdditionalData,
  MAX_PLAINTEXT_FRAME_BYTES,
  type StreamContext,
  type StreamManifest,
} from "./file-format.js";

export type { StreamContext, StreamManifest } from "./file-format.js";

type StreamSink = (chunk: Uint8Array) => void | Promise<void>;

export type EncryptStreamInput = Readonly<{
  key: Uint8Array;
  context: StreamContext;
  chunks: AsyncIterable<Uint8Array>;
  onChunk: StreamSink;
}>;

export async function encryptStream(input: EncryptStreamInput): Promise<StreamManifest> {
  const key = assertKeyBytes(input.key, "key");
  await sodium.ready;
  const push = sodium.crypto_secretstream_xchacha20poly1305_init_push(key);
  const plaintextHash = createSha256Accumulator();
  const ciphertextHash = createSha256Accumulator();
  let plaintextBytes = 0;
  let ciphertextBytes = 0;
  let frameCount = 0;
  let sequence = 0;
  let pending: Uint8Array | undefined;

  const emit = async (chunk: Uint8Array): Promise<void> => {
    const copy = new Uint8Array(chunk);
    ciphertextHash.update(copy);
    ciphertextBytes += copy.length;
    await input.onChunk(copy);
  };

  const pushFrame = async (message: Uint8Array, tag: number): Promise<void> => {
    const aad = frameAdditionalData(input.context, sequence);
    let ciphertext: Uint8Array | undefined;
    try {
      ciphertext = new Uint8Array(
        sodium.crypto_secretstream_xchacha20poly1305_push(push.state, message, aad, tag),
      );
      await emit(encodeFrameLength(ciphertext.length));
      await emit(ciphertext);
      frameCount += 1;
      sequence += 1;
    } finally {
      aad.fill(0);
      ciphertext?.fill(0);
    }
  };

  try {
    await emit(encodeFileHeader(push.header));
    for await (const source of input.chunks) {
      if (!(source instanceof Uint8Array)) throw new TypeError("stream chunks must be Uint8Array");
      plaintextHash.update(source);
      plaintextBytes += source.length;
      for (let offset = 0; offset < source.length; offset += MAX_PLAINTEXT_FRAME_BYTES) {
        const piece = new Uint8Array(source.subarray(offset, offset + MAX_PLAINTEXT_FRAME_BYTES));
        if (pending !== undefined) {
          await pushFrame(pending, sodium.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE);
          pending.fill(0);
        }
        pending = piece;
      }
    }
    if (pending === undefined) {
      await pushFrame(new Uint8Array(0), sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL);
    } else {
      await pushFrame(pending, sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL);
      pending.fill(0);
      pending = undefined;
    }
    const plaintextSha256 = encodeBase64Url(plaintextHash.final());
    const ciphertextSha256 = encodeBase64Url(ciphertextHash.final());
    return {
      version: 1,
      algorithm: "secretstream-xchacha20poly1305",
      plaintextBytes,
      ciphertextBytes,
      plaintextSha256,
      ciphertextSha256,
      frameCount,
    };
  } finally {
    key.fill(0);
    push.header.fill(0);
    pending?.fill(0);
  }
}
