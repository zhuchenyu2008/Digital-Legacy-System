import sodium from "libsodium-wrappers-sumo";
import { z } from "zod";
import type { ContactKeyPair } from "../keys/contact-key-pair.js";
import { decodeBase64Url, encodeBase64Url, isCanonicalBase64Url } from "../protocol/base64url.js";

export const FRAGMENT_INGRESS_ALGORITHM = "x25519-xsalsa20poly1305-v1" as const;
export const FRAGMENT_PURPOSES = ["DEATH", "RECOVERY"] as const;
export type FragmentPurpose = (typeof FRAGMENT_PURPOSES)[number];

const Base64UrlField = z.string().refine(isCanonicalBase64Url, "must be canonical base64url");

const FragmentContextSchema = z
  .object({
    protocolVersion: z.literal(1),
    workflowId: z.string().min(1),
    contactId: z.string().min(1),
    generationId: z.string().min(1),
    shareIndex: z.number().int().safe().min(1),
    purpose: z.enum(FRAGMENT_PURPOSES),
    commitmentDigest: Base64UrlField,
    ingressKeyVersion: z.number().int().safe().min(1),
  })
  .strict()
  .superRefine((value, context) => {
    if (decodeBase64Url(value.commitmentDigest).length !== 32) {
      context.addIssue({
        code: "custom",
        path: ["commitmentDigest"],
        message: "commitmentDigest must be 32 bytes",
      });
    }
  });

export const FragmentIngressV1Schema = FragmentContextSchema.extend({
  algorithm: z.literal(FRAGMENT_INGRESS_ALGORITHM),
  nonce: Base64UrlField,
  ciphertext: Base64UrlField,
})
  .strict()
  .superRefine((value, context) => {
    if (decodeBase64Url(value.nonce).length !== sodium.crypto_box_NONCEBYTES) {
      context.addIssue({ code: "custom", path: ["nonce"], message: "nonce must be 24 bytes" });
    }
    if (
      decodeBase64Url(value.ciphertext).length <=
      sodium.crypto_box_PUBLICKEYBYTES + sodium.crypto_box_MACBYTES
    ) {
      context.addIssue({
        code: "custom",
        path: ["ciphertext"],
        message: "ciphertext is too short",
      });
    }
  });

export type FragmentIngressV1 = Readonly<z.infer<typeof FragmentIngressV1Schema>>;
export type FragmentIngressExpected = Readonly<
  Omit<z.infer<typeof FragmentContextSchema>, "protocolVersion">
>;

const FragmentPlaintextSchema = FragmentContextSchema.extend({ share: Base64UrlField }).strict();
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

function ownKey(value: Uint8Array, name: string): Uint8Array {
  if (!(value instanceof Uint8Array) || value.length !== sodium.crypto_box_PUBLICKEYBYTES) {
    throw new Error(`${name} must be 32 bytes`);
  }
  return new Uint8Array(value);
}

function canonicalBytes(value: Record<string, unknown>): Uint8Array {
  const ordered = Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, value[key]]),
  );
  return textEncoder.encode(JSON.stringify(ordered));
}

function contextFrom(value: FragmentIngressExpected) {
  return FragmentContextSchema.parse({
    protocolVersion: 1,
    workflowId: value.workflowId,
    contactId: value.contactId,
    generationId: value.generationId,
    shareIndex: value.shareIndex,
    purpose: value.purpose,
    commitmentDigest: value.commitmentDigest,
    ingressKeyVersion: value.ingressKeyVersion,
  });
}

function sameContext(
  left: z.infer<typeof FragmentContextSchema>,
  right: z.infer<typeof FragmentContextSchema>,
): boolean {
  return (
    left.protocolVersion === right.protocolVersion &&
    left.workflowId === right.workflowId &&
    left.contactId === right.contactId &&
    left.generationId === right.generationId &&
    left.shareIndex === right.shareIndex &&
    left.purpose === right.purpose &&
    left.commitmentDigest === right.commitmentDigest &&
    left.ingressKeyVersion === right.ingressKeyVersion
  );
}

export async function assertX25519KeyPair(keyPair: ContactKeyPair): Promise<void> {
  const publicKey = ownKey(keyPair.publicKey, "public key");
  const privateKey = ownKey(keyPair.privateKey, "private key");
  let derivedPublic: Uint8Array | undefined;
  try {
    await sodium.ready;
    derivedPublic = new Uint8Array(sodium.crypto_scalarmult_base(privateKey));
    if (!sodium.memcmp(publicKey, derivedPublic)) throw new Error("X25519 key pair does not match");
  } finally {
    publicKey.fill(0);
    privateKey.fill(0);
    derivedPublic?.fill(0);
  }
}

export async function sealFragmentIngressV1(
  input: Readonly<FragmentIngressExpected & { share: Uint8Array; recipientPublicKey: Uint8Array }>,
): Promise<FragmentIngressV1> {
  const context = contextFrom(input);
  if (!(input.share instanceof Uint8Array) || input.share.length === 0) {
    throw new Error("share must be non-empty bytes");
  }
  const recipientPublicKey = ownKey(input.recipientPublicKey, "recipient public key");
  const ownedShare = new Uint8Array(input.share);
  let plaintext: Uint8Array | undefined;
  let nonce: Uint8Array | undefined;
  let senderPublicKey: Uint8Array | undefined;
  let senderPrivateKey: Uint8Array | undefined;
  let boxed: Uint8Array | undefined;
  let ciphertext: Uint8Array | undefined;
  try {
    plaintext = canonicalBytes({ ...context, share: encodeBase64Url(ownedShare) });
    await sodium.ready;
    const sender = sodium.crypto_box_keypair();
    senderPublicKey = new Uint8Array(sender.publicKey);
    senderPrivateKey = new Uint8Array(sender.privateKey);
    nonce = new Uint8Array(sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES));
    boxed = new Uint8Array(
      sodium.crypto_box_easy(plaintext, nonce, recipientPublicKey, senderPrivateKey),
    );
    ciphertext = new Uint8Array(senderPublicKey.length + boxed.length);
    ciphertext.set(senderPublicKey);
    ciphertext.set(boxed, senderPublicKey.length);
    return Object.freeze(
      FragmentIngressV1Schema.parse({
        ...context,
        algorithm: FRAGMENT_INGRESS_ALGORITHM,
        nonce: encodeBase64Url(nonce),
        ciphertext: encodeBase64Url(ciphertext),
      }),
    );
  } finally {
    recipientPublicKey.fill(0);
    ownedShare.fill(0);
    plaintext?.fill(0);
    nonce?.fill(0);
    senderPublicKey?.fill(0);
    senderPrivateKey?.fill(0);
    boxed?.fill(0);
    ciphertext?.fill(0);
  }
}

export async function openFragmentIngressV1(
  input: Readonly<{
    envelope: FragmentIngressV1;
    recipientKeyPair: ContactKeyPair;
    expected: FragmentIngressExpected;
  }>,
): Promise<Uint8Array> {
  const envelope = FragmentIngressV1Schema.parse(input.envelope);
  const expected = contextFrom(input.expected);
  if (!sameContext(envelope, expected)) throw new Error("Fragment ingress context mismatch");
  await assertX25519KeyPair(input.recipientKeyPair);
  const recipientPrivateKey = ownKey(input.recipientKeyPair.privateKey, "recipient private key");
  const nonce = decodeBase64Url(envelope.nonce);
  const combinedCiphertext = decodeBase64Url(envelope.ciphertext);
  const senderPublicKey = combinedCiphertext.slice(0, sodium.crypto_box_PUBLICKEYBYTES);
  const boxed = combinedCiphertext.slice(sodium.crypto_box_PUBLICKEYBYTES);
  let plaintext: Uint8Array | undefined;
  try {
    await sodium.ready;
    plaintext = new Uint8Array(
      sodium.crypto_box_open_easy(boxed, nonce, senderPublicKey, recipientPrivateKey),
    );
    const encoded = textDecoder.decode(plaintext);
    const parsed = FragmentPlaintextSchema.parse(JSON.parse(encoded));
    if (textDecoder.decode(canonicalBytes(parsed)) !== encoded) {
      throw new Error("Fragment ingress plaintext is not canonical");
    }
    if (!sameContext(parsed, envelope)) throw new Error("Fragment ingress context mismatch");
    return decodeBase64Url(parsed.share);
  } finally {
    recipientPrivateKey.fill(0);
    nonce.fill(0);
    combinedCiphertext.fill(0);
    senderPublicKey.fill(0);
    boxed.fill(0);
    plaintext?.fill(0);
  }
}
