import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

const AUTH_TAG_BYTES = 16;

export class AesNotificationCipher {
  readonly #key: Buffer;

  public constructor(rootSecret: Uint8Array) {
    if (rootSecret.byteLength < 32) {
      throw new Error("Notification encryption root must be 32 bytes");
    }
    this.#key = createHmac("sha256", rootSecret)
      .update("dls:notification-encryption:v1", "utf8")
      .digest();
  }

  public async encrypt(value: string, purpose: string) {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.#key, nonce);
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
    const decipher = createDecipheriv("aes-256-gcm", this.#key, nonce);
    decipher.setAAD(Buffer.from(purpose, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
  }
}
