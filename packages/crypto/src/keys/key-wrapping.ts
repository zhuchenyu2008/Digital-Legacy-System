import sodium from "libsodium-wrappers-sumo";

import {
  WRAPPED_KEY_ALGORITHM,
  WRAPPED_KEY_PURPOSES,
  type WrappedKeyPurpose,
} from "../protocol/algorithms.js";
import { decodeBase64Url, encodeBase64Url } from "../protocol/base64url.js";
import { type CanonicalAadInput, canonicalizeAad } from "../protocol/canonical-aad.js";
import {
  decodeWrappedKeyV1,
  type WrappedKeyV1,
  WrappedKeyV1Schema,
} from "../protocol/envelopes.js";
import { assertKeyBytes } from "./key-material.js";

const NONCE_BYTES = 24;

export type WrapKeyInput = Readonly<{
  key: Uint8Array;
  wrappingKey: Uint8Array;
  aad: CanonicalAadInput;
}>;

export type UnwrapKeyInput = Readonly<{
  envelope: WrappedKeyV1 | string;
  wrappingKey: Uint8Array;
  aad: CanonicalAadInput;
}>;

function assertPurpose(value: string): asserts value is WrappedKeyPurpose {
  if (!(WRAPPED_KEY_PURPOSES as readonly string[]).includes(value)) {
    throw new Error(`Unsupported wrapped-key purpose: ${value}`);
  }
}

function validateAad(aad: CanonicalAadInput): Uint8Array {
  if (aad.algorithm !== WRAPPED_KEY_ALGORITHM) {
    throw new Error("Wrapped-key AAD algorithm mismatch");
  }
  assertPurpose(aad.purpose);
  return canonicalizeAad(aad);
}

export async function wrapKeyV1(input: WrapKeyInput): Promise<WrappedKeyV1> {
  const key = assertKeyBytes(input.key, "key");
  const wrappingKey = assertKeyBytes(input.wrappingKey, "wrappingKey");
  let aad: Uint8Array | undefined;
  let nonce: Uint8Array | undefined;
  let ciphertext: Uint8Array | undefined;
  try {
    aad = validateAad(input.aad);
    await sodium.ready;
    nonce = new Uint8Array(sodium.randombytes_buf(NONCE_BYTES));
    ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
      key,
      aad,
      null,
      nonce,
      wrappingKey,
    );
    return WrappedKeyV1Schema.parse({
      version: 1,
      algorithm: WRAPPED_KEY_ALGORITHM,
      purpose: input.aad.purpose,
      keyId: input.aad.keyId,
      nonce: encodeBase64Url(nonce),
      ciphertext: encodeBase64Url(ciphertext),
    });
  } finally {
    key.fill(0);
    wrappingKey.fill(0);
    aad?.fill(0);
    nonce?.fill(0);
    ciphertext?.fill(0);
  }
}

export async function unwrapKeyV1(input: UnwrapKeyInput): Promise<Uint8Array> {
  const envelope =
    typeof input.envelope === "string"
      ? decodeWrappedKeyV1(input.envelope)
      : WrappedKeyV1Schema.parse(input.envelope);
  const wrappingKey = assertKeyBytes(input.wrappingKey, "wrappingKey");
  let aad: Uint8Array | undefined;
  let nonce: Uint8Array | undefined;
  let ciphertext: Uint8Array | undefined;
  try {
    aad = validateAad(input.aad);
    if (
      envelope.version !== input.aad.version ||
      envelope.algorithm !== input.aad.algorithm ||
      envelope.purpose !== input.aad.purpose ||
      envelope.keyId !== input.aad.keyId
    ) {
      throw new Error("Wrapped-key envelope context mismatch");
    }
    nonce = decodeBase64Url(envelope.nonce);
    ciphertext = decodeBase64Url(envelope.ciphertext);
    await sodium.ready;
    return new Uint8Array(
      sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, ciphertext, aad, nonce, wrappingKey),
    );
  } finally {
    wrappingKey.fill(0);
    aad?.fill(0);
    nonce?.fill(0);
    ciphertext?.fill(0);
  }
}
