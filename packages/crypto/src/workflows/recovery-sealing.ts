import sodium from "libsodium-wrappers-sumo";
import { z } from "zod";
import { decodeBase64Url, encodeBase64Url, isCanonicalBase64Url } from "../protocol/base64url.js";
import { assertX25519KeyPair } from "./fragment-ingress.js";

export const RECOVERY_VAULT_KEY_SEAL_PROTOCOL = "dls-recovery-vault-key-v1" as const;

const RecoveryVaultKeyPlaintextSchema = z
  .object({
    protocol: z.literal(RECOVERY_VAULT_KEY_SEAL_PROTOCOL),
    workflowId: z.string().min(1),
    vaultKey: z.string().refine(isCanonicalBase64Url, "must be canonical base64url"),
  })
  .strict()
  .superRefine((value, context) => {
    if (decodeBase64Url(value.vaultKey).length !== 32) {
      context.addIssue({
        code: "custom",
        path: ["vaultKey"],
        message: "vaultKey must be 32 bytes",
      });
    }
  });

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

function ownKey(value: Uint8Array, name: string): Uint8Array {
  if (!(value instanceof Uint8Array) || value.length !== sodium.crypto_box_PUBLICKEYBYTES) {
    throw new Error(`${name} must be 32 bytes`);
  }
  return new Uint8Array(value);
}

function canonicalBytes(value: Readonly<Record<string, unknown>>): Uint8Array {
  return textEncoder.encode(
    JSON.stringify(
      Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => [key, value[key]]),
      ),
    ),
  );
}

export async function sealRecoveryVaultKeyV1(
  input: Readonly<{
    workflowId: string;
    vaultKey: Uint8Array;
    recipientPublicKey: Uint8Array;
  }>,
): Promise<Uint8Array> {
  const recipientPublicKey = ownKey(input.recipientPublicKey, "recipient public key");
  const vaultKey = new Uint8Array(input.vaultKey);
  if (input.workflowId.length === 0 || vaultKey.length !== 32) {
    recipientPublicKey.fill(0);
    vaultKey.fill(0);
    throw new Error("recovery sealing context is invalid");
  }
  let plaintext: Uint8Array | undefined;
  try {
    const parsed = RecoveryVaultKeyPlaintextSchema.parse({
      protocol: RECOVERY_VAULT_KEY_SEAL_PROTOCOL,
      workflowId: input.workflowId,
      vaultKey: encodeBase64Url(vaultKey),
    });
    plaintext = canonicalBytes(parsed);
    await sodium.ready;
    return new Uint8Array(sodium.crypto_box_seal(plaintext, recipientPublicKey));
  } finally {
    recipientPublicKey.fill(0);
    vaultKey.fill(0);
    plaintext?.fill(0);
  }
}

export async function openRecoveryVaultKeyV1(
  input: Readonly<{
    workflowId: string;
    sealed: Uint8Array;
    recipientPublicKey: Uint8Array;
    recipientPrivateKey: Uint8Array;
  }>,
): Promise<Uint8Array> {
  await assertX25519KeyPair({
    publicKey: input.recipientPublicKey,
    privateKey: input.recipientPrivateKey,
  });
  const publicKey = ownKey(input.recipientPublicKey, "recipient public key");
  const privateKey = ownKey(input.recipientPrivateKey, "recipient private key");
  const sealed = new Uint8Array(input.sealed);
  let plaintext: Uint8Array | undefined;
  try {
    await sodium.ready;
    plaintext = new Uint8Array(sodium.crypto_box_seal_open(sealed, publicKey, privateKey));
    const encoded = textDecoder.decode(plaintext);
    const parsed = RecoveryVaultKeyPlaintextSchema.parse(JSON.parse(encoded));
    if (textDecoder.decode(canonicalBytes(parsed)) !== encoded) {
      throw new Error("recovery vault-key plaintext is not canonical");
    }
    if (parsed.workflowId !== input.workflowId) {
      throw new Error("recovery vault-key context mismatch");
    }
    return decodeBase64Url(parsed.vaultKey);
  } finally {
    publicKey.fill(0);
    privateKey.fill(0);
    sealed.fill(0);
    plaintext?.fill(0);
  }
}
