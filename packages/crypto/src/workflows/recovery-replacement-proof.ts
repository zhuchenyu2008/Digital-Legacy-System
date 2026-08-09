import { decodeBase64Url, encodeBase64Url } from "../protocol/base64url.js";

export type RecoveryReplacementEnvelope = Readonly<{
  ciphertext: string;
  nonce: string;
  kdfSalt: string;
  kdfParams: Readonly<{
    algorithm: string;
    memoryKiB: number;
    iterations: number;
    parallelism: number;
    version: number;
    purpose: string;
  }>;
  keyVerifierCiphertext: string;
  keyVerifierNonce: string;
  vkCommitment: string;
  aadHash?: string;
}>;

export type RecoveryReplacementProofInput = Readonly<{
  workflowId: string;
  vaultId: string;
  vaultKey: Uint8Array;
  sealedVaultKeyDigest: Uint8Array;
  newPassword: string;
  envelope: RecoveryReplacementEnvelope;
}>;

function proofMessage(input: RecoveryReplacementProofInput, purpose: string): Uint8Array {
  if (
    input.workflowId.length === 0 ||
    input.vaultId.length === 0 ||
    input.vaultKey.length !== 32 ||
    input.sealedVaultKeyDigest.length !== 32
  ) {
    throw new Error("recovery replacement proof context is invalid");
  }
  const envelope = input.envelope;
  return new TextEncoder().encode(
    JSON.stringify({
      envelope: {
        ...(envelope.aadHash === undefined ? {} : { aadHash: envelope.aadHash }),
        ciphertext: envelope.ciphertext,
        kdfParams: {
          algorithm: envelope.kdfParams.algorithm,
          iterations: envelope.kdfParams.iterations,
          memoryKiB: envelope.kdfParams.memoryKiB,
          parallelism: envelope.kdfParams.parallelism,
          purpose: envelope.kdfParams.purpose,
          version: envelope.kdfParams.version,
        },
        kdfSalt: envelope.kdfSalt,
        keyVerifierCiphertext: envelope.keyVerifierCiphertext,
        keyVerifierNonce: envelope.keyVerifierNonce,
        nonce: envelope.nonce,
        vkCommitment: envelope.vkCommitment,
      },
      newPassword: input.newPassword.normalize("NFC"),
      protocol: "dls-recovery-replacement-proof-v1",
      purpose,
      sealedVaultKeyDigest: encodeBase64Url(input.sealedVaultKeyDigest),
      vaultId: input.vaultId,
      workflowId: input.workflowId,
    }),
  );
}

async function sign(input: RecoveryReplacementProofInput, purpose: string): Promise<Uint8Array> {
  const key = new Uint8Array(input.vaultKey);
  const message = proofMessage(input, purpose);
  try {
    const imported = await crypto.subtle.importKey(
      "raw",
      key,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    return new Uint8Array(await crypto.subtle.sign("HMAC", imported, message));
  } finally {
    key.fill(0);
    message.fill(0);
  }
}

function same(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

export async function createRecoveryReplacementProofsV1(
  input: RecoveryReplacementProofInput,
): Promise<Readonly<{ ownerEnvelopeProof: string; vaultKeyProof: string }>> {
  const ownerEnvelopeProof = await sign(input, "owner-envelope");
  const vaultKeyProof = await sign(input, "vault-key");
  try {
    return Object.freeze({
      ownerEnvelopeProof: encodeBase64Url(ownerEnvelopeProof),
      vaultKeyProof: encodeBase64Url(vaultKeyProof),
    });
  } finally {
    ownerEnvelopeProof.fill(0);
    vaultKeyProof.fill(0);
  }
}

export async function verifyRecoveryReplacementProofsV1(
  input: RecoveryReplacementProofInput &
    Readonly<{ ownerEnvelopeProof: string; vaultKeyProof: string }>,
): Promise<boolean> {
  let ownerEnvelopeProof: Uint8Array;
  let vaultKeyProof: Uint8Array;
  try {
    ownerEnvelopeProof = decodeBase64Url(input.ownerEnvelopeProof);
    vaultKeyProof = decodeBase64Url(input.vaultKeyProof);
  } catch {
    return false;
  }
  const expectedOwner = await sign(input, "owner-envelope");
  const expectedVault = await sign(input, "vault-key");
  try {
    return same(ownerEnvelopeProof, expectedOwner) && same(vaultKeyProof, expectedVault);
  } finally {
    ownerEnvelopeProof.fill(0);
    vaultKeyProof.fill(0);
    expectedOwner.fill(0);
    expectedVault.fill(0);
  }
}
