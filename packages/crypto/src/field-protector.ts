import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import type { FieldKeyring } from "@dls/contracts";

const AUTH_TAG_BYTES = 16;

export type ProtectedField = Readonly<{
  ciphertext: Uint8Array;
  nonce: Uint8Array;
  keyVersion: number;
  lookupHmac: Uint8Array;
}>;

export type ProtectedFieldEnvelope = Readonly<{
  ciphertext: Uint8Array;
  nonce: Uint8Array;
  keyVersion: number;
}>;

function legacyKeyring(secret: Uint8Array): FieldKeyring {
  const key = createHash("sha256").update(secret).digest();
  const lookupKey = Buffer.from(key);
  return Object.freeze({
    formatVersion: 1 as const,
    activeVersion: 1,
    lookupKey,
    lookupKeys: new Map([[1, lookupKey]]),
    keys: new Map([[1, key]]),
  });
}

export class VersionedFieldProtector {
  readonly #keyring: FieldKeyring;
  readonly #legacyKey: Buffer | undefined;

  public constructor(keyring: FieldKeyring | Uint8Array, legacySecret?: Uint8Array) {
    this.#keyring = keyring instanceof Uint8Array ? legacyKeyring(keyring) : keyring;
    this.#legacyKey =
      keyring instanceof Uint8Array || legacySecret === undefined
        ? undefined
        : createHash("sha256").update(legacySecret).digest();
    if (
      this.#keyring.lookupKey.length !== 32 ||
      !this.#keyring.keys.has(this.#keyring.activeVersion)
    ) {
      throw new Error("Field encryption keyring is invalid");
    }
  }

  public async protect(value: string, purpose: string): Promise<ProtectedField> {
    const key = this.#keyring.keys.get(this.#keyring.activeVersion);
    if (key === undefined) throw new Error("Active field encryption key is unavailable");
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    cipher.setAAD(Buffer.from(purpose, "utf8"));
    const ciphertext = Buffer.concat([
      cipher.update(value, "utf8"),
      cipher.final(),
      cipher.getAuthTag(),
    ]);
    const lookupHmac = createHmac("sha256", this.#keyring.lookupKey).update(value, "utf8").digest();
    return { ciphertext, nonce, keyVersion: this.#keyring.activeVersion, lookupHmac };
  }

  public async lookup(value: string): Promise<Uint8Array> {
    return createHmac("sha256", this.#keyring.lookupKey).update(value, "utf8").digest();
  }

  public async lookupCandidates(value: string): Promise<readonly Uint8Array[]> {
    const candidates: Uint8Array[] = [];
    const seen = new Set<string>();
    const add = (key: Uint8Array) => {
      const candidate = createHmac("sha256", key).update(value, "utf8").digest();
      const fingerprint = candidate.toString("hex");
      if (seen.has(fingerprint)) {
        candidate.fill(0);
        return;
      }
      seen.add(fingerprint);
      candidates.push(candidate);
    };
    for (const key of this.#keyring.lookupKeys.values()) add(key);
    if (this.#legacyKey !== undefined) add(this.#legacyKey);
    return candidates;
  }

  public async unprotect(value: ProtectedFieldEnvelope, purpose: string): Promise<string> {
    if (value.nonce.length !== 12 || value.ciphertext.length <= AUTH_TAG_BYTES) {
      throw new Error("Protected field envelope is invalid");
    }
    const key = this.#keyring.keys.get(value.keyVersion);
    if (key === undefined) throw new Error("Protected field key version is unavailable");
    const ciphertext = Buffer.from(value.ciphertext);
    const decrypt = (candidate: Uint8Array): string => {
      const decipher = createDecipheriv("aes-256-gcm", candidate, value.nonce);
      decipher.setAAD(Buffer.from(purpose, "utf8"));
      decipher.setAuthTag(ciphertext.subarray(ciphertext.length - AUTH_TAG_BYTES));
      return Buffer.concat([
        decipher.update(ciphertext.subarray(0, ciphertext.length - AUTH_TAG_BYTES)),
        decipher.final(),
      ]).toString("utf8");
    };
    try {
      return decrypt(key);
    } catch (error) {
      if (value.keyVersion !== 1 || this.#legacyKey === undefined) throw error;
      return decrypt(this.#legacyKey);
    }
  }
}

export { VersionedFieldProtector as AesFieldProtector };
