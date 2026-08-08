import { z } from "zod";

import {
  WRAPPED_KEY_ALGORITHM,
  WRAPPED_KEY_PURPOSES,
  type WrappedKeyPurpose,
} from "./algorithms.js";
import { decodeBase64Url, isCanonicalBase64Url } from "./base64url.js";

const Base64UrlField = z.string().refine(isCanonicalBase64Url, "must be canonical base64url");

export const WrappedKeyV1Schema = z
  .object({
    version: z.literal(1),
    algorithm: z.literal(WRAPPED_KEY_ALGORITHM),
    purpose: z.enum(WRAPPED_KEY_PURPOSES),
    keyId: z.string().min(1),
    nonce: Base64UrlField,
    ciphertext: Base64UrlField,
  })
  .strict()
  .superRefine((value, context) => {
    if (decodeBase64Url(value.nonce).length !== 24) {
      context.addIssue({ code: "custom", path: ["nonce"], message: "nonce must be 24 bytes" });
    }
    if (decodeBase64Url(value.ciphertext).length < 16) {
      context.addIssue({
        code: "custom",
        path: ["ciphertext"],
        message: "ciphertext is too short",
      });
    }
  });

export type WrappedKeyV1 = Readonly<{
  version: 1;
  algorithm: typeof WRAPPED_KEY_ALGORITHM;
  purpose: WrappedKeyPurpose;
  keyId: string;
  nonce: string;
  ciphertext: string;
}>;

const ENVELOPE_KEYS = ["algorithm", "ciphertext", "keyId", "nonce", "purpose", "version"] as const;

export function encodeWrappedKeyV1(value: WrappedKeyV1): string {
  const parsed = WrappedKeyV1Schema.parse(value);
  return JSON.stringify(Object.fromEntries(ENVELOPE_KEYS.map((key) => [key, parsed[key]])));
}

export function decodeWrappedKeyV1(encoded: string): WrappedKeyV1 {
  if (typeof encoded !== "string" || encoded.trim() !== encoded || encoded.length === 0) {
    throw new Error("Envelope must be a non-whitespace JSON string");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(encoded) as unknown;
  } catch {
    throw new Error("Envelope is not valid JSON");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Envelope must be a JSON object");
  }
  for (const key of ENVELOPE_KEYS) {
    const count = encoded.match(new RegExp(`"${key}"\\s*:`, "gu"))?.length ?? 0;
    if (count !== 1) throw new Error(`Envelope field ${key} must occur exactly once`);
  }
  return WrappedKeyV1Schema.parse(parsed);
}
