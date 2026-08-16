import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import type { FieldKeyring } from "@dls/contracts";

const AUTH_TAG_BYTES = 16;

export class AesNotificationCipher {
  readonly #keys: readonly Buffer[];

  public constructor(rootSecret: Uint8Array | FieldKeyring, legacyRoot?: Uint8Array) {
    const roots =
      rootSecret instanceof Uint8Array
        ? [{ root: rootSecret, version: "v1" as const }]
        : [
            ...[rootSecret.activeVersion, ...rootSecret.keys.keys()]
              .filter((version, index, values) => values.indexOf(version) === index)
              .map((version) => ({
                root: rootSecret.keys.get(version),
                version: "v2" as const,
              })),
          ];
    const keys: Buffer[] = [];
    for (const candidate of roots) {
      if (candidate.root === undefined || candidate.root.byteLength < 32) {
        throw new Error("Notification encryption root must be 32 bytes");
      }
      keys.push(
        createHmac("sha256", candidate.root)
          .update(`dls:notification-encryption:${candidate.version}`, "utf8")
          .digest(),
      );
    }
    if (legacyRoot !== undefined) {
      if (legacyRoot.byteLength < 32)
        throw new Error("Notification encryption root must be 32 bytes");
      keys.push(
        createHmac("sha256", legacyRoot).update("dls:notification-encryption:v1", "utf8").digest(),
      );
    }
    this.#keys = Object.freeze(keys);
  }

  public async encrypt(value: string, purpose: string) {
    const nonce = randomBytes(12);
    const key = this.#keys[0];
    if (key === undefined) throw new Error("Notification encryption key is unavailable");
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    cipher.setAAD(Buffer.from(purpose, "utf8"));
    const ciphertext = Buffer.concat([
      cipher.update(value, "utf8"),
      cipher.final(),
      cipher.getAuthTag(),
    ]);
    return { ciphertext, nonce };
  }

  public async decrypt(ciphertext: Uint8Array, nonce: Uint8Array, purpose: string) {
    if (nonce.byteLength !== 12 || ciphertext.byteLength <= AUTH_TAG_BYTES) {
      throw new Error("Encrypted notification value is invalid");
    }
    const encrypted = Buffer.from(ciphertext);
    const body = encrypted.subarray(0, encrypted.byteLength - AUTH_TAG_BYTES);
    const tag = encrypted.subarray(encrypted.byteLength - AUTH_TAG_BYTES);
    let lastError: unknown;
    for (const key of this.#keys) {
      try {
        const decipher = createDecipheriv("aes-256-gcm", key, nonce);
        decipher.setAAD(Buffer.from(purpose, "utf8"));
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError ?? new Error("Encrypted notification value is invalid");
  }
}
