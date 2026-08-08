import { z } from "zod";

import { decodeBase64Url, isCanonicalBase64Url } from "./base64url.js";

export const WRAPPED_KEY_ALGORITHM = "xchacha20poly1305-ietf" as const;
export const KDF_ALGORITHM = "argon2id13" as const;

export const WRAPPED_KEY_PURPOSES = [
  "owner-vk",
  "contact-private-key",
  "package-dek",
  "release-stage-vk",
  "recovery-stage-vk",
] as const;

export type WrappedKeyPurpose = (typeof WRAPPED_KEY_PURPOSES)[number];

export const KdfProfileV1Schema = z
  .object({
    version: z.literal(1),
    algorithm: z.literal(KDF_ALGORITHM),
    opsLimit: z.number().int().safe().min(1),
    memLimit: z
      .number()
      .int()
      .safe()
      .min(8 * 1024),
    salt: z.string().refine(isCanonicalBase64Url, "salt must be canonical base64url"),
    outputBytes: z.literal(32),
  })
  .strict()
  .superRefine((profile, context) => {
    try {
      if (decodeBase64Url(profile.salt).length < 16) {
        context.addIssue({
          code: "custom",
          path: ["salt"],
          message: "salt must be at least 16 bytes",
        });
      }
    } catch {
      context.addIssue({ code: "custom", path: ["salt"], message: "salt must be valid base64url" });
    }
  });

export type KdfProfileV1 = z.infer<typeof KdfProfileV1Schema>;
