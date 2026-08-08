import sodium from "libsodium-wrappers-sumo";
import { z } from "zod";
import type { ContactKeyPair } from "../keys/contact-key-pair.js";
import { decodeBase64Url, encodeBase64Url, isCanonicalBase64Url } from "../protocol/base64url.js";

export const SHARE_ENVELOPE_ALGORITHM = "crypto-box-seal" as const;
export const SHARE_PURPOSES = ["death-share", "recovery-share"] as const;
export type SharePurpose = (typeof SHARE_PURPOSES)[number];

const Base64UrlField = z.string().refine(isCanonicalBase64Url, "must be canonical base64url");

export const ShareEnvelopeV1Schema = z
  .object({
    version: z.literal(1),
    algorithm: z.literal(SHARE_ENVELOPE_ALGORITHM),
    purpose: z.enum(SHARE_PURPOSES),
    vaultId: z.string().min(1),
    generationId: z.string().min(1),
    contactId: z.string().min(1),
    shareIndex: z.number().int().safe().min(1),
    threshold: z.number().int().safe().min(2),
    commitmentDigest: Base64UrlField,
    ciphertext: Base64UrlField,
  })
  .strict()
  .superRefine((value, context) => {
    try {
      if (decodeBase64Url(value.commitmentDigest).length !== 32) {
        context.addIssue({
          code: "custom",
          path: ["commitmentDigest"],
          message: "commitmentDigest must be 32 bytes",
        });
      }
      if (decodeBase64Url(value.ciphertext).length < sodium.crypto_box_SEALBYTES) {
        context.addIssue({
          code: "custom",
          path: ["ciphertext"],
          message: "ciphertext is too short",
        });
      }
    } catch {
      context.addIssue({ code: "custom", path: ["ciphertext"], message: "invalid binary field" });
    }
  });

export type ShareEnvelopeV1 = Readonly<z.infer<typeof ShareEnvelopeV1Schema>>;

type ShareMetadata = Readonly<{
  purpose: SharePurpose;
  vaultId: string;
  generationId: string;
  contactId: string;
  shareIndex: number;
  threshold: number;
  commitmentDigest: string;
}>;

type SharePlaintext = ShareMetadata & Readonly<{ version: 1; share: string }>;

const SharePlaintextSchema = z
  .object({
    version: z.literal(1),
    purpose: z.enum(SHARE_PURPOSES),
    vaultId: z.string().min(1),
    generationId: z.string().min(1),
    contactId: z.string().min(1),
    shareIndex: z.number().int().safe().min(1),
    threshold: z.number().int().safe().min(2),
    commitmentDigest: Base64UrlField,
    share: Base64UrlField,
  })
  .strict();

const textEncoder = new TextEncoder();

function canonicalObject(value: Record<string, unknown>): Uint8Array {
  const ordered = Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, value[key]]),
  );
  return textEncoder.encode(JSON.stringify(ordered));
}

function validatePublicKey(value: Uint8Array): Uint8Array {
  if (!(value instanceof Uint8Array) || value.length !== 32) {
    throw new Error("Contact public key must be 32 bytes");
  }
  return new Uint8Array(value);
}

function validateMetadata(metadata: ShareMetadata): ShareMetadata {
  if (!Number.isSafeInteger(metadata.shareIndex) || metadata.shareIndex < 1) {
    throw new Error("shareIndex must be a positive safe integer");
  }
  if (!Number.isSafeInteger(metadata.threshold) || metadata.threshold < 2) {
    throw new Error("threshold must be at least 2");
  }
  for (const field of ["vaultId", "generationId", "contactId", "commitmentDigest"] as const) {
    if (typeof metadata[field] !== "string" || metadata[field].length === 0) {
      throw new Error(`${field} must be non-empty`);
    }
  }
  if (!(SHARE_PURPOSES as readonly string[]).includes(metadata.purpose)) {
    throw new Error("Unsupported share purpose");
  }
  SharePlaintextSchema.shape.commitmentDigest.parse(metadata.commitmentDigest);
  return metadata;
}

function sameMetadata(left: ShareMetadata, right: ShareMetadata): boolean {
  return (
    left.purpose === right.purpose &&
    left.vaultId === right.vaultId &&
    left.generationId === right.generationId &&
    left.contactId === right.contactId &&
    left.shareIndex === right.shareIndex &&
    left.threshold === right.threshold &&
    left.commitmentDigest === right.commitmentDigest
  );
}

export async function sealShareV1(
  input: Readonly<ShareMetadata & { share: Uint8Array; contactPublicKey: Uint8Array }>,
): Promise<ShareEnvelopeV1> {
  const metadata = validateMetadata({
    purpose: input.purpose,
    vaultId: input.vaultId,
    generationId: input.generationId,
    contactId: input.contactId,
    shareIndex: input.shareIndex,
    threshold: input.threshold,
    commitmentDigest: input.commitmentDigest,
  });
  if (!(input.share instanceof Uint8Array) || input.share.length === 0) {
    throw new Error("share must be a non-empty Uint8Array");
  }
  const publicKey = validatePublicKey(input.contactPublicKey);
  const plaintext = canonicalObject({
    ...metadata,
    share: encodeBase64Url(input.share),
    version: 1,
  });
  try {
    await sodium.ready;
    const ciphertext = sodium.crypto_box_seal(plaintext, publicKey);
    return Object.freeze(
      ShareEnvelopeV1Schema.parse({
        version: 1,
        algorithm: SHARE_ENVELOPE_ALGORITHM,
        ...metadata,
        ciphertext: encodeBase64Url(ciphertext),
      }),
    );
  } finally {
    plaintext.fill(0);
    publicKey.fill(0);
  }
}

export type OpenShareExpected = Readonly<{
  vaultId: string;
  generationId: string;
  purpose: SharePurpose;
  contactId: string;
}>;

export async function openShareV1(
  input: Readonly<{
    envelope: ShareEnvelopeV1;
    keyPair: ContactKeyPair;
    expected: OpenShareExpected;
  }>,
): Promise<Uint8Array> {
  const envelope = ShareEnvelopeV1Schema.parse(input.envelope);
  if (
    envelope.vaultId !== input.expected.vaultId ||
    envelope.generationId !== input.expected.generationId ||
    envelope.purpose !== input.expected.purpose ||
    envelope.contactId !== input.expected.contactId
  ) {
    throw new Error("Share envelope context mismatch");
  }
  const publicKey = validatePublicKey(input.keyPair.publicKey);
  if (!(input.keyPair.privateKey instanceof Uint8Array) || input.keyPair.privateKey.length !== 32) {
    throw new Error("Contact private key must be 32 bytes");
  }
  const ciphertext = decodeBase64Url(envelope.ciphertext);
  let opened: Uint8Array | undefined;
  try {
    await sodium.ready;
    opened = new Uint8Array(
      sodium.crypto_box_seal_open(ciphertext, publicKey, new Uint8Array(input.keyPair.privateKey)),
    );
    const encoded = new TextDecoder().decode(opened);
    const parsed = SharePlaintextSchema.parse(JSON.parse(encoded)) as SharePlaintext;
    if (
      new TextDecoder().decode(canonicalObject(parsed as unknown as Record<string, unknown>)) !==
      encoded
    ) {
      throw new Error("Share plaintext is not canonical JSON");
    }
    const metadata: ShareMetadata = {
      purpose: parsed.purpose,
      vaultId: parsed.vaultId,
      generationId: parsed.generationId,
      contactId: parsed.contactId,
      shareIndex: parsed.shareIndex,
      threshold: parsed.threshold,
      commitmentDigest: parsed.commitmentDigest,
    };
    const outerMetadata: ShareMetadata = {
      purpose: envelope.purpose,
      vaultId: envelope.vaultId,
      generationId: envelope.generationId,
      contactId: envelope.contactId,
      shareIndex: envelope.shareIndex,
      threshold: envelope.threshold,
      commitmentDigest: envelope.commitmentDigest,
    };
    if (!sameMetadata(metadata, outerMetadata)) throw new Error("Share metadata mismatch");
    return decodeBase64Url(parsed.share);
  } finally {
    publicKey.fill(0);
    ciphertext.fill(0);
    opened?.fill(0);
  }
}
