import sodium from "libsodium-wrappers-sumo";
import { WRAPPED_KEY_ALGORITHM } from "../protocol/algorithms.js";
import { encodeBase64Url } from "../protocol/base64url.js";
import type { WrappedKeyV1 } from "../protocol/envelopes.js";
import { assertKeyBytes, hashWithLabel } from "./key-material.js";
import { unwrapKeyV1, wrapKeyV1 } from "./key-wrapping.js";

const CONTACT_KEY_ID_LABEL = "DLS/CONTACT-PUBLIC-KEY-ID/V1\0";

export type ContactKeyPair = Readonly<{
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}>;

export async function generateContactKeyPair(): Promise<ContactKeyPair> {
  await sodium.ready;
  const pair = sodium.crypto_box_keypair();
  return Object.freeze({
    publicKey: new Uint8Array(pair.publicKey),
    privateKey: new Uint8Array(pair.privateKey),
  });
}

async function assertMatchingContactKeyPair(
  publicKey: Uint8Array,
  privateKey: Uint8Array,
): Promise<void> {
  const expectedPublic = assertKeyBytes(publicKey, "publicKey");
  const ownedPrivate = assertKeyBytes(privateKey, "privateKey");
  let derivedPublic: Uint8Array | undefined;
  try {
    await sodium.ready;
    derivedPublic = new Uint8Array(sodium.crypto_scalarmult_base(ownedPrivate));
    let mismatch = 0;
    for (let index = 0; index < expectedPublic.length; index += 1) {
      mismatch |= (expectedPublic[index] ?? 0) ^ (derivedPublic[index] ?? 0);
    }
    if (mismatch !== 0) throw new Error("Contact key pair does not match");
  } finally {
    expectedPublic.fill(0);
    ownedPrivate.fill(0);
    derivedPublic?.fill(0);
  }
}

export async function contactKeyId(publicKey: Uint8Array): Promise<string> {
  const key = assertKeyBytes(publicKey, "publicKey");
  try {
    return encodeBase64Url(await hashWithLabel(CONTACT_KEY_ID_LABEL, key));
  } finally {
    key.fill(0);
  }
}

export type ContactPrivateKeyWrapInput = Readonly<{
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  contactKek: Uint8Array;
  vaultId: string;
  contactId: string;
}>;

export async function wrapContactPrivateKey(
  input: ContactPrivateKeyWrapInput,
): Promise<WrappedKeyV1> {
  await assertMatchingContactKeyPair(input.publicKey, input.privateKey);
  const keyId = await contactKeyId(input.publicKey);
  return wrapKeyV1({
    key: input.privateKey,
    wrappingKey: input.contactKek,
    aad: {
      protocol: "dls-crypto-v1",
      version: 1,
      purpose: "contact-private-key",
      vaultId: input.vaultId,
      contactId: input.contactId,
      keyId,
      algorithm: WRAPPED_KEY_ALGORITHM,
    },
  });
}

export async function unwrapContactPrivateKey(
  input: Readonly<{
    envelope: WrappedKeyV1 | string;
    publicKey: Uint8Array;
    contactKek: Uint8Array;
    vaultId: string;
    contactId: string;
  }>,
): Promise<Uint8Array> {
  const keyId = await contactKeyId(input.publicKey);
  const privateKey = await unwrapKeyV1({
    envelope: input.envelope,
    wrappingKey: input.contactKek,
    aad: {
      protocol: "dls-crypto-v1",
      version: 1,
      purpose: "contact-private-key",
      vaultId: input.vaultId,
      contactId: input.contactId,
      keyId,
      algorithm: WRAPPED_KEY_ALGORITHM,
    },
  });
  try {
    await assertMatchingContactKeyPair(input.publicKey, privateKey);
    return privateKey;
  } catch (error) {
    privateKey.fill(0);
    throw error;
  }
}
