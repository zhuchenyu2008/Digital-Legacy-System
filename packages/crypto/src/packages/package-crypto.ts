import sodium from "libsodium-wrappers-sumo";
import { decodeBase64Url, encodeBase64Url } from "../protocol/base64url.js";
import { canonicalizeAad } from "../protocol/canonical-aad.js";

const ALGORITHM = "xchacha20poly1305-ietf" as const;
const NONCE_BYTES = 24;

export type PackageCryptoContext = Readonly<{
  vaultId: string;
  packageId: string;
  packageVersion: number;
}>;

export type EncryptedPackageManifestV1 = Readonly<{
  algorithm: typeof ALGORITHM;
  ciphertext: Uint8Array;
  nonce: Uint8Array;
  aadHash: Uint8Array;
}>;

function manifestAad(context: PackageCryptoContext): Uint8Array {
  return canonicalizeAad({
    protocol: "dls-crypto-v1",
    version: 1,
    purpose: "package-manifest",
    keyId: `manifest-${context.packageVersion}`,
    vaultId: context.vaultId,
    packageId: context.packageId,
    packageVersion: context.packageVersion,
    algorithm: ALGORITHM,
  });
}

function assertKey(value: Uint8Array): Uint8Array {
  if (!(value instanceof Uint8Array) || value.length !== 32) {
    throw new Error("package key must be 32 bytes");
  }
  return new Uint8Array(value);
}

function assertContext(context: PackageCryptoContext): void {
  if (
    context === null ||
    typeof context.vaultId !== "string" ||
    context.vaultId.length === 0 ||
    typeof context.packageId !== "string" ||
    context.packageId.length === 0 ||
    !Number.isSafeInteger(context.packageVersion) ||
    context.packageVersion < 1
  ) {
    throw new Error("invalid package manifest context");
  }
}

export async function encryptPackageManifestV1(
  input: Readonly<{
    key: Uint8Array;
    context: PackageCryptoContext;
    manifest: Readonly<Record<string, unknown>>;
  }>,
): Promise<EncryptedPackageManifestV1> {
  assertContext(input.context);
  const key = assertKey(input.key);
  const aad = manifestAad(input.context);
  await sodium.ready;
  const nonce = new Uint8Array(sodium.randombytes_buf(NONCE_BYTES));
  const plaintext = new TextEncoder().encode(JSON.stringify(input.manifest));
  try {
    const ciphertext = new Uint8Array(
      sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(plaintext, aad, null, nonce, key),
    );
    return {
      algorithm: ALGORITHM,
      ciphertext,
      nonce: new Uint8Array(nonce),
      aadHash: new Uint8Array(sodium.crypto_hash_sha256(aad)),
    };
  } finally {
    key.fill(0);
    aad.fill(0);
    plaintext.fill(0);
    nonce.fill(0);
  }
}

export async function decryptPackageManifestV1(
  input: Readonly<{
    key: Uint8Array;
    context: PackageCryptoContext;
    encrypted: EncryptedPackageManifestV1;
  }>,
): Promise<Readonly<Record<string, unknown>>> {
  assertContext(input.context);
  if (input.encrypted.algorithm !== ALGORITHM || input.encrypted.nonce.length !== NONCE_BYTES) {
    throw new Error("unsupported package manifest envelope");
  }
  const key = assertKey(input.key);
  const aad = manifestAad(input.context);
  await sodium.ready;
  const expectedHash = new Uint8Array(sodium.crypto_hash_sha256(aad));
  const suppliedHash = new Uint8Array(input.encrypted.aadHash);
  try {
    if (suppliedHash.length !== expectedHash.length || !sodium.memcmp(suppliedHash, expectedHash)) {
      throw new Error("package manifest AAD mismatch");
    }
    const plaintext = new Uint8Array(
      sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
        null,
        input.encrypted.ciphertext,
        aad,
        input.encrypted.nonce,
        key,
      ),
    );
    try {
      const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as unknown;
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("package manifest must be an object");
      }
      return parsed as Readonly<Record<string, unknown>>;
    } finally {
      plaintext.fill(0);
    }
  } finally {
    key.fill(0);
    aad.fill(0);
    expectedHash.fill(0);
    suppliedHash.fill(0);
  }
}

export function encodePackageBytes(value: Uint8Array): string {
  return encodeBase64Url(value);
}

export function decodePackageBytes(value: string): Uint8Array {
  return decodeBase64Url(value);
}
