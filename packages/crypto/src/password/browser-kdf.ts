import sodium from "libsodium-wrappers-sumo";
import { type KdfProfileV1, KdfProfileV1Schema } from "../protocol/algorithms.js";
import { decodeBase64Url } from "../protocol/base64url.js";
import { normalizePassword } from "./normalize-password.js";

export async function deriveBrowserKey(
  password: string,
  profile: KdfProfileV1,
): Promise<Uint8Array> {
  const validated = KdfProfileV1Schema.parse(profile);
  const passwordBytes = normalizePassword(password);
  const salt = decodeBase64Url(validated.salt);
  try {
    await sodium.ready;
    return sodium.crypto_pwhash(
      validated.outputBytes,
      passwordBytes,
      salt,
      validated.opsLimit,
      validated.memLimit,
      sodium.crypto_pwhash_ALG_ARGON2ID13,
    );
  } finally {
    passwordBytes.fill(0);
    salt.fill(0);
  }
}
