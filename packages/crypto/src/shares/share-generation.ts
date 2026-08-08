import { hashWithLabel } from "../keys/key-material.js";
import { encodeBase64Url } from "../protocol/base64url.js";
import { type ShareEnvelopeV1, type SharePurpose, sealShareV1 } from "./share-envelope.js";

const SHARE_COMMITMENT_DIGEST_LABEL = "DLS/SHARE-COMMITMENT-DIGEST/V1\0";
const textEncoder = new TextEncoder();

export type ShareGeneration = Readonly<{
  version: 1;
  vaultId: string;
  generationId: string;
  purpose: SharePurpose;
  threshold: number;
  shares: readonly Uint8Array[];
  commitments: Uint8Array;
  commitmentDigest: string;
}>;

type ShareGenerationInput = Readonly<{
  vaultId: string;
  generationId: string;
  purpose: SharePurpose;
  threshold: number;
  shares: readonly Uint8Array[];
  commitments: Uint8Array;
}>;

function canonicalGenerationBytes(input: ShareGenerationInput): Uint8Array {
  const record = {
    commitments: encodeBase64Url(input.commitments),
    generationId: input.generationId,
    purpose: input.purpose,
    shareCount: input.shares.length,
    threshold: input.threshold,
    vaultId: input.vaultId,
    version: 1,
  };
  return textEncoder.encode(JSON.stringify(record));
}

function validateInput(input: ShareGenerationInput): void {
  if (input.vaultId.length === 0 || input.generationId.length === 0) {
    throw new Error("vaultId and generationId must be non-empty");
  }
  if (!(input.purpose === "death-share" || input.purpose === "recovery-share")) {
    throw new Error("Unsupported share purpose");
  }
  if (!Number.isSafeInteger(input.threshold) || input.threshold < 2) {
    throw new Error("threshold must be at least 2");
  }
  if (input.threshold > input.shares.length || input.shares.length === 0) {
    throw new Error("threshold must not exceed share count");
  }
  if (!(input.commitments instanceof Uint8Array) || input.commitments.length === 0) {
    throw new Error("commitments must be non-empty bytes");
  }
  for (const share of input.shares) {
    if (!(share instanceof Uint8Array) || share.length === 0) {
      throw new Error("shares must be non-empty byte arrays");
    }
  }
}

export async function createShareGeneration(input: ShareGenerationInput): Promise<ShareGeneration> {
  validateInput(input);
  const commitments = new Uint8Array(input.commitments);
  const shares = input.shares.map((share) => new Uint8Array(share));
  const digestInput = canonicalGenerationBytes({ ...input, commitments, shares });
  try {
    const commitmentDigest = encodeBase64Url(
      await hashWithLabel(SHARE_COMMITMENT_DIGEST_LABEL, digestInput),
    );
    return Object.freeze({
      version: 1,
      vaultId: input.vaultId,
      generationId: input.generationId,
      purpose: input.purpose,
      threshold: input.threshold,
      shares: Object.freeze(shares),
      commitments,
      commitmentDigest,
    });
  } finally {
    digestInput.fill(0);
  }
}

export async function sealShareGeneration(
  input: Readonly<{
    generation: ShareGeneration;
    contacts: readonly Readonly<{ contactId: string; publicKey: Uint8Array }>[];
  }>,
): Promise<readonly ShareEnvelopeV1[]> {
  const generation = input.generation;
  if (input.contacts.length !== generation.shares.length) {
    throw new Error("one contact is required for every share");
  }
  const contactIds = new Set<string>();
  for (const contact of input.contacts) {
    if (contact.contactId.length === 0 || contactIds.has(contact.contactId)) {
      throw new Error("contact IDs must be unique and non-empty");
    }
    contactIds.add(contact.contactId);
  }
  const envelopes: ShareEnvelopeV1[] = [];
  for (let index = 0; index < generation.shares.length; index += 1) {
    const contact = input.contacts[index];
    const share = generation.shares[index];
    if (contact === undefined || share === undefined) throw new Error("share/contact mismatch");
    envelopes.push(
      await sealShareV1({
        share,
        contactPublicKey: contact.publicKey,
        purpose: generation.purpose,
        vaultId: generation.vaultId,
        generationId: generation.generationId,
        contactId: contact.contactId,
        shareIndex: index + 1,
        threshold: generation.threshold,
        commitmentDigest: generation.commitmentDigest,
      }),
    );
  }
  return Object.freeze(envelopes);
}
