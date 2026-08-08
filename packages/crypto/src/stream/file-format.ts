import sodium from "libsodium-wrappers-sumo";

import { canonicalizeAad } from "../protocol/canonical-aad.js";

export const FILE_FORMAT_VERSION = 1 as const;
export const FILE_ALGORITHM_ID = 1 as const;
export const FILE_MAGIC = "DLSF" as const;
export const SECRETSTREAM_HEADER_BYTES = 24;
export const SECRETSTREAM_ABYTES = 17;
export const FILE_HEADER_BYTES = 4 + 1 + 1 + 2 + SECRETSTREAM_HEADER_BYTES;
export const FRAME_LENGTH_BYTES = 4;
export const MAX_PLAINTEXT_FRAME_BYTES = 1024 * 1024;
export const MAX_CIPHERTEXT_FRAME_BYTES = MAX_PLAINTEXT_FRAME_BYTES + SECRETSTREAM_ABYTES;
export const STREAM_ALGORITHM = "secretstream-xchacha20poly1305" as const;

export type StreamContext = Readonly<{
  vaultId: string;
  packageId: string;
  packageVersion: number;
}>;

export type StreamManifest = Readonly<{
  version: 1;
  algorithm: typeof STREAM_ALGORITHM;
  plaintextBytes: number;
  ciphertextBytes: number;
  plaintextSha256: string;
  ciphertextSha256: string;
  frameCount: number;
}>;

export function encodeFileHeader(secretstreamHeader: Uint8Array): Uint8Array {
  if (
    !(secretstreamHeader instanceof Uint8Array) ||
    secretstreamHeader.length !== SECRETSTREAM_HEADER_BYTES
  ) {
    throw new Error(`secretstream header must be ${SECRETSTREAM_HEADER_BYTES} bytes`);
  }
  const output = new Uint8Array(FILE_HEADER_BYTES);
  output.set(new TextEncoder().encode(FILE_MAGIC), 0);
  output[4] = FILE_FORMAT_VERSION;
  output[5] = FILE_ALGORITHM_ID;
  new DataView(output.buffer).setUint16(6, FILE_HEADER_BYTES, false);
  output.set(secretstreamHeader, 8);
  return output;
}

export function parseFileHeader(header: Uint8Array): Uint8Array {
  if (!(header instanceof Uint8Array) || header.length !== FILE_HEADER_BYTES) {
    throw new Error("Invalid DLSF header length");
  }
  if (new TextDecoder().decode(header.subarray(0, 4)) !== FILE_MAGIC) {
    throw new Error("Invalid DLSF magic");
  }
  if (header[4] !== FILE_FORMAT_VERSION || header[5] !== FILE_ALGORITHM_ID) {
    throw new Error("Unsupported DLSF version or algorithm");
  }
  if (
    new DataView(header.buffer, header.byteOffset, header.byteLength).getUint16(6, false) !==
    FILE_HEADER_BYTES
  ) {
    throw new Error("Invalid DLSF fixed header length");
  }
  return new Uint8Array(header.subarray(8));
}

export function encodeFrameLength(length: number): Uint8Array {
  if (
    !Number.isSafeInteger(length) ||
    length < SECRETSTREAM_ABYTES ||
    length > MAX_CIPHERTEXT_FRAME_BYTES
  ) {
    throw new Error("DLSF frame length is outside the configured limit");
  }
  const output = new Uint8Array(FRAME_LENGTH_BYTES);
  new DataView(output.buffer).setUint32(0, length, false);
  return output;
}

export function parseFrameLength(value: Uint8Array): number {
  if (!(value instanceof Uint8Array) || value.length !== FRAME_LENGTH_BYTES) {
    throw new Error("Invalid DLSF frame length field");
  }
  const length = new DataView(value.buffer, value.byteOffset, value.byteLength).getUint32(0, false);
  if (length < SECRETSTREAM_ABYTES || length > MAX_CIPHERTEXT_FRAME_BYTES) {
    throw new Error("DLSF frame length is outside the configured limit");
  }
  return length;
}

export function frameAdditionalData(context: StreamContext, sequence: number): Uint8Array {
  if (
    typeof context.vaultId !== "string" ||
    context.vaultId.length === 0 ||
    typeof context.packageId !== "string" ||
    context.packageId.length === 0 ||
    !Number.isSafeInteger(context.packageVersion) ||
    context.packageVersion < 1 ||
    !Number.isSafeInteger(sequence) ||
    sequence < 0
  ) {
    throw new Error("Invalid DLSF stream context");
  }
  return canonicalizeAad({
    protocol: "dls-stream-v1",
    version: FILE_FORMAT_VERSION,
    purpose: "encrypted-file-frame",
    vaultId: context.vaultId,
    packageId: context.packageId,
    packageVersion: context.packageVersion,
    keyId: `frame-${sequence}`,
    algorithm: STREAM_ALGORITHM,
  });
}

export function createSha256Accumulator(): Readonly<{
  update: (chunk: Uint8Array) => void;
  final: () => Uint8Array;
}> {
  const state = sodium.crypto_hash_sha256_init();
  let finalized = false;
  return {
    update(chunk) {
      if (finalized) throw new Error("SHA-256 accumulator is already finalized");
      state && sodium.crypto_hash_sha256_update(state, chunk);
    },
    final() {
      if (finalized) throw new Error("SHA-256 accumulator is already finalized");
      finalized = true;
      return new Uint8Array(sodium.crypto_hash_sha256_final(state));
    },
  };
}
