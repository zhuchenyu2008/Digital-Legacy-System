import { createHmac, randomBytes } from "node:crypto";
import type { VersionedRepository } from "../ports/repositories.js";
import type { FieldProtector } from "../setup/field-protector.js";

export type ContactPrivateKeyEnvelope = Readonly<{
  publicKey: string;
  ciphertext: string;
  nonce: string;
  kdfSalt: string;
  kdfParams: Readonly<{
    algorithm: "argon2id";
    memoryKiB: number;
    iterations: number;
    parallelism: number;
    version: number;
    purpose: "contact-private-key-kek-v1";
  }>;
  privateKeyProof: string;
}>;

export type ContactConsentInput = Readonly<{
  version: string;
  documentSha256: string;
  termsAccepted: boolean;
  privacyAccepted: boolean;
  denialDisclosureAccepted: boolean;
  stage2LockAccepted: boolean;
}>;

export type ContactDependenciesBase = Readonly<{
  transaction: import("../ports/transaction-manager.js").TransactionManager;
  tokenPepper: Uint8Array;
  fieldProtector: FieldProtector;
  idFactory?: () => string;
}>;

export class ContactUseCaseError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "ContactUseCaseError";
  }
}

export function repository(
  value: VersionedRepository | undefined,
  name: string,
): VersionedRepository {
  if (value === undefined)
    throw new ContactUseCaseError("CONTACT_UNAVAILABLE", `${name} is unavailable`, 503);
  return value;
}

export function normalizeContactName(value: string): string {
  const normalized = value.normalize("NFC").trim();
  if (
    normalized.length === 0 ||
    normalized.length > 120 ||
    /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(normalized)
  ) {
    throw new ContactUseCaseError("CONTACT_INVALID", "contact display name is invalid");
  }
  return normalized;
}

export function normalizeEmail(value: string): string {
  const normalized = value.normalize("NFC").trim().toLowerCase();
  if (
    normalized.length > 320 ||
    !/^[\x21-\x7e]+$/u.test(normalized) ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalized)
  ) {
    throw new ContactUseCaseError("CONTACT_INVALID", "contact email is invalid");
  }
  return normalized;
}

export function decodeBase64Url(
  value: string,
  field: string,
  minimumBytes: number,
  exactBytes?: number,
): Buffer {
  if (!/^[A-Za-z0-9_-]+$/u.test(value) || value.length % 4 === 1) {
    throw new ContactUseCaseError("CONTACT_KEY_INVALID", `${field} is invalid`);
  }
  const decoded = Buffer.from(value, "base64url");
  if (
    decoded.length < minimumBytes ||
    (exactBytes !== undefined && decoded.length !== exactBytes)
  ) {
    throw new ContactUseCaseError("CONTACT_KEY_INVALID", `${field} has an invalid length`);
  }
  return decoded;
}

export function decodeHex(value: string, field: string, bytes: number): Buffer {
  if (!new RegExp(`^[0-9a-f]{${bytes * 2}}$`, "u").test(value)) {
    throw new ContactUseCaseError("CONTACT_CONSENT_INVALID", `${field} is invalid`);
  }
  return Buffer.from(value, "hex");
}

export function validatePassword(value: string): void {
  const bytes = new TextEncoder().encode(value.normalize("NFC"));
  if (bytes.length < 12 || bytes.length > 512) {
    throw new ContactUseCaseError("CONTACT_PASSWORD_INVALID", "contact password is invalid");
  }
}

export function digestToken(token: string, pepper: Uint8Array): Buffer {
  return createHmac("sha256", pepper).update(token, "utf8").digest();
}

export function makeToken(factory?: () => Uint8Array): string {
  const bytes = factory?.() ?? randomBytes(32);
  if (!(bytes instanceof Uint8Array) || bytes.length !== 32) {
    throw new ContactUseCaseError(
      "CONTACT_TOKEN_INVALID",
      "token generator returned invalid material",
      500,
    );
  }
  return Buffer.from(bytes).toString("base64url");
}

export function protectBytes(value: Uint8Array | Buffer): Buffer {
  return Buffer.from(value);
}
