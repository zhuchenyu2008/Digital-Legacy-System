import sodium from "libsodium-wrappers-sumo";
import { z } from "zod";
import { assertKeyBytes } from "../keys/key-material.js";
import { decodeBase64Url, encodeBase64Url, isCanonicalBase64Url } from "../protocol/base64url.js";
import { FRAGMENT_PURPOSES, type FragmentIngressExpected } from "./fragment-ingress.js";

export const STAGE_FRAGMENT_ALGORITHM = "xchacha20poly1305-ietf" as const;
const Base64UrlField = z.string().refine(isCanonicalBase64Url, "must be canonical base64url");

const StageContextSchema = z
  .object({
    protocolVersion: z.literal(1),
    workflowId: z.string().min(1),
    contactId: z.string().min(1),
    generationId: z.string().min(1),
    shareIndex: z.number().int().safe().min(1),
    purpose: z.enum(FRAGMENT_PURPOSES),
    commitmentDigest: Base64UrlField,
    ingressKeyVersion: z.number().int().safe().min(1),
    stageKeyVersion: z.number().int().safe().min(1),
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

export const StageFragmentV1Schema = StageContextSchema.extend({
  algorithm: z.literal(STAGE_FRAGMENT_ALGORITHM),
  nonce: Base64UrlField,
  ciphertext: Base64UrlField,
})
  .strict()
  .superRefine((value, context) => {
    if (
      decodeBase64Url(value.nonce).length !== sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES
    ) {
      context.addIssue({ code: "custom", path: ["nonce"], message: "nonce must be 24 bytes" });
    }
    if (
      decodeBase64Url(value.ciphertext).length <= sodium.crypto_aead_xchacha20poly1305_ietf_ABYTES
    ) {
      context.addIssue({
        code: "custom",
        path: ["ciphertext"],
        message: "ciphertext is too short",
      });
    }
  });

export type StageFragmentV1 = Readonly<z.infer<typeof StageFragmentV1Schema>>;
export type StageFragmentExpected = Readonly<FragmentIngressExpected & { stageKeyVersion: number }>;

function contextFrom(value: StageFragmentExpected) {
  return StageContextSchema.parse({
    protocolVersion: 1,
    workflowId: value.workflowId,
    contactId: value.contactId,
    generationId: value.generationId,
    shareIndex: value.shareIndex,
    purpose: value.purpose,
    commitmentDigest: value.commitmentDigest,
    ingressKeyVersion: value.ingressKeyVersion,
    stageKeyVersion: value.stageKeyVersion,
  });
}

function canonicalBytes(value: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify(
      Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => [key, value[key]]),
      ),
    ),
  );
}

function sameContext(
  left: z.infer<typeof StageContextSchema>,
  right: z.infer<typeof StageContextSchema>,
): boolean {
  return Object.keys(right).every(
    (key) => left[key as keyof typeof left] === right[key as keyof typeof right],
  );
}

export async function wrapStageFragmentV1(
  input: Readonly<
    StageFragmentExpected & {
      share: Uint8Array;
      stageKey: Uint8Array;
    }
  >,
): Promise<StageFragmentV1> {
  const context = contextFrom(input);
  if (!(input.share instanceof Uint8Array) || input.share.length === 0) {
    throw new Error("share must be non-empty bytes");
  }
  const share = new Uint8Array(input.share);
  const stageKey = assertKeyBytes(input.stageKey, "stageKey");
  let aad: Uint8Array | undefined;
  let nonce: Uint8Array | undefined;
  let ciphertext: Uint8Array | undefined;
  try {
    aad = canonicalBytes(context);
    await sodium.ready;
    nonce = new Uint8Array(
      sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES),
    );
    ciphertext = new Uint8Array(
      sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(share, aad, null, nonce, stageKey),
    );
    return Object.freeze(
      StageFragmentV1Schema.parse({
        ...context,
        algorithm: STAGE_FRAGMENT_ALGORITHM,
        nonce: encodeBase64Url(nonce),
        ciphertext: encodeBase64Url(ciphertext),
      }),
    );
  } finally {
    share.fill(0);
    stageKey.fill(0);
    aad?.fill(0);
    nonce?.fill(0);
    ciphertext?.fill(0);
  }
}

export async function openStageFragmentV1(
  input: Readonly<{
    envelope: StageFragmentV1;
    stageKey: Uint8Array;
    expected: StageFragmentExpected;
  }>,
): Promise<Uint8Array> {
  const envelope = StageFragmentV1Schema.parse(input.envelope);
  const expected = contextFrom(input.expected);
  if (!sameContext(envelope, expected)) throw new Error("Stage fragment context mismatch");
  const stageKey = assertKeyBytes(input.stageKey, "stageKey");
  const aad = canonicalBytes(expected);
  const nonce = decodeBase64Url(envelope.nonce);
  const ciphertext = decodeBase64Url(envelope.ciphertext);
  try {
    await sodium.ready;
    return new Uint8Array(
      sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, ciphertext, aad, nonce, stageKey),
    );
  } finally {
    stageKey.fill(0);
    aad.fill(0);
    nonce.fill(0);
    ciphertext.fill(0);
  }
}
