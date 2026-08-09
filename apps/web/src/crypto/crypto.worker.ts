/// <reference lib="webworker" />

import {
  commitVaultKey,
  createRecoveryReplacementProofsV1,
  decodeBase64Url,
  deriveBrowserKey,
  encodeBase64Url,
  generateContactKeyPair,
  generateVaultKey,
  openRecoveryVaultKeyV1,
  unwrapContactPrivateKey,
  unwrapKeyV1,
  wrapContactPrivateKey,
  wrapKeyV1,
} from "@dls/crypto/browser";
import { createContactFragment } from "./contact-fragment";
import { buildShareGenerationUpload } from "./share-generation";
import type { CryptoOperation } from "./worker-client";

type RequestMessage = Readonly<{ id: string; operation: CryptoOperation; payload: unknown }>;

const scope = self as unknown as DedicatedWorkerGlobalScope;
const encoder = new TextEncoder();

function bytes(value: string): Uint8Array {
  return decodeBase64Url(value);
}

function hex(value: Uint8Array): string {
  return [...value].map((item) => item.toString(16).padStart(2, "0")).join("");
}

async function hmac(key: Uint8Array, message: string): Promise<string> {
  const imported = await crypto.subtle.importKey(
    "raw",
    key.slice().buffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return encodeBase64Url(
    new Uint8Array(await crypto.subtle.sign("HMAC", imported, encoder.encode(message))),
  );
}

async function ownerEnvelope(password: string, vaultKey: Uint8Array, vaultId: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const profile = {
    version: 1 as const,
    algorithm: "argon2id13" as const,
    opsLimit: 3,
    memLimit: 64 * 1024 * 1024,
    salt: encodeBase64Url(salt),
    outputBytes: 32 as const,
  };
  const wrappingKey = await deriveBrowserKey(password, profile);
  try {
    const wrapped = await wrapKeyV1({
      key: vaultKey,
      wrappingKey,
      aad: {
        protocol: "dls-crypto-v1",
        version: 1,
        purpose: "owner-vk",
        vaultId,
        keyId: "owner-vk",
        algorithm: "xchacha20poly1305-ietf",
      },
    });
    const commitment = await commitVaultKey(vaultKey);
    try {
      return {
        ciphertext: wrapped.ciphertext,
        nonce: wrapped.nonce,
        kdfSalt: profile.salt,
        kdfParams: {
          algorithm: "argon2id",
          memoryKiB: 65_536,
          iterations: 3,
          parallelism: 1,
          version: 19,
          purpose: "owner-vault-kek-v1",
        },
        keyVerifierCiphertext: await hmac(wrappingKey, "DLS/OWNER-KEY-VERIFIER/V1"),
        keyVerifierNonce: encodeBase64Url(crypto.getRandomValues(new Uint8Array(24))),
        vkCommitment: hex(commitment),
        ownerEnvelopeProof: await hmac(
          vaultKey,
          `${vaultId}:${wrapped.ciphertext}:${wrapped.nonce}`,
        ),
      };
    } finally {
      commitment.fill(0);
    }
  } finally {
    wrappingKey.fill(0);
    salt.fill(0);
  }
}

async function unwrapOwner(payload: Record<string, unknown>): Promise<Uint8Array> {
  const envelope = payload.envelope as Record<string, unknown>;
  const salt = String(envelope.kdfSalt);
  const wrappingKey = await deriveBrowserKey(String(payload.password), {
    version: 1,
    algorithm: "argon2id13",
    opsLimit: 3,
    memLimit: 64 * 1024 * 1024,
    salt,
    outputBytes: 32,
  });
  try {
    return await unwrapKeyV1({
      envelope: {
        version: 1,
        algorithm: "xchacha20poly1305-ietf",
        purpose: "owner-vk",
        keyId: "owner-vk",
        nonce: String(envelope.nonce),
        ciphertext: String(envelope.ciphertext),
      },
      wrappingKey,
      aad: {
        protocol: "dls-crypto-v1",
        version: 1,
        purpose: "owner-vk",
        vaultId: String(payload.vaultId),
        keyId: "owner-vk",
        algorithm: "xchacha20poly1305-ietf",
      },
    });
  } finally {
    wrappingKey.fill(0);
  }
}

async function execute(operation: CryptoOperation, raw: unknown): Promise<unknown> {
  const payload = (raw ?? {}) as Record<string, unknown>;
  if (operation === "createOwnerVault") {
    const vaultKey = await generateVaultKey();
    try {
      return {
        envelope: await ownerEnvelope(
          String(payload.password),
          vaultKey,
          String(payload.vaultId ?? "pending-setup"),
        ),
      };
    } finally {
      vaultKey.fill(0);
    }
  }
  if (operation === "unwrapOwnerVault") {
    const value = await unwrapOwner(payload);
    try {
      return { vaultKey: encodeBase64Url(value) };
    } finally {
      value.fill(0);
    }
  }
  if (operation === "rewrapOwnerVault") {
    const vaultKey = await unwrapOwner({
      password: payload.oldPassword,
      envelope: payload.envelope,
      vaultId: payload.vaultId,
    });
    try {
      return {
        envelope: await ownerEnvelope(
          String(payload.newPassword),
          vaultKey,
          String(payload.vaultId),
        ),
      };
    } finally {
      vaultKey.fill(0);
    }
  }
  if (operation === "createContactKeys") {
    const pair = await generateContactKeyPair();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const profile = {
      version: 1 as const,
      algorithm: "argon2id13" as const,
      opsLimit: 3,
      memLimit: 64 * 1024 * 1024,
      salt: encodeBase64Url(salt),
      outputBytes: 32 as const,
    };
    const kek = await deriveBrowserKey(String(payload.password), profile);
    try {
      const wrapped = await wrapContactPrivateKey({
        privateKey: pair.privateKey,
        publicKey: pair.publicKey,
        contactKek: kek,
        vaultId: String(payload.vaultId),
        contactId: String(payload.contactId),
      });
      return {
        publicKey: encodeBase64Url(pair.publicKey),
        privateKeyEnvelope: {
          publicKey: encodeBase64Url(pair.publicKey),
          ciphertext: wrapped.ciphertext,
          nonce: wrapped.nonce,
          kdfSalt: profile.salt,
          kdfParams: {
            algorithm: "argon2id",
            memoryKiB: 65_536,
            iterations: 3,
            parallelism: 1,
            version: 19,
            purpose: "contact-private-key-kek-v1",
          },
          privateKeyProof: await hmac(pair.privateKey, `${payload.vaultId}:${payload.contactId}`),
        },
      };
    } finally {
      pair.privateKey.fill(0);
      pair.publicKey.fill(0);
      kek.fill(0);
      salt.fill(0);
    }
  }
  if (operation === "rewrapContactPrivateKey") {
    const publicKey = bytes(String(payload.publicKey));
    const envelope = payload.envelope as Record<string, unknown>;
    const oldKek = await deriveBrowserKey(String(payload.oldPassword), {
      version: 1,
      algorithm: "argon2id13",
      opsLimit: 3,
      memLimit: 64 * 1024 * 1024,
      salt: String(envelope.kdfSalt),
      outputBytes: 32,
    });
    const privateKey = await unwrapContactPrivateKey({
      envelope: {
        version: 1,
        algorithm: "xchacha20poly1305-ietf",
        purpose: "contact-private-key",
        keyId: String(payload.keyId),
        nonce: String(envelope.nonce),
        ciphertext: String(envelope.ciphertext),
      },
      publicKey,
      contactKek: oldKek,
      vaultId: String(payload.vaultId),
      contactId: String(payload.contactId),
    });
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const profile = {
      version: 1 as const,
      algorithm: "argon2id13" as const,
      opsLimit: 3,
      memLimit: 64 * 1024 * 1024,
      salt: encodeBase64Url(salt),
      outputBytes: 32 as const,
    };
    const newKek = await deriveBrowserKey(String(payload.newPassword), profile);
    try {
      const wrapped = await wrapContactPrivateKey({
        privateKey,
        publicKey,
        contactKek: newKek,
        vaultId: String(payload.vaultId),
        contactId: String(payload.contactId),
      });
      return {
        publicKey: encodeBase64Url(publicKey),
        ciphertext: wrapped.ciphertext,
        nonce: wrapped.nonce,
        kdfSalt: profile.salt,
        kdfParams: {
          algorithm: "argon2id",
          memoryKiB: 65_536,
          iterations: 3,
          parallelism: 1,
          version: 19,
          purpose: "contact-private-key-kek-v1",
        },
        privateKeyProof: await hmac(privateKey, `${payload.vaultId}:${payload.contactId}`),
      };
    } finally {
      publicKey.fill(0);
      privateKey.fill(0);
      oldKek.fill(0);
      newKek.fill(0);
      salt.fill(0);
    }
  }
  if (operation === "createContactFragment") {
    return createContactFragment(payload as never);
  }
  if (operation === "createShareGeneration") {
    return buildShareGenerationUpload(payload as never);
  }
  if (operation === "openRecoveryVault") {
    const vaultKey = await openRecoveryVaultKeyV1({
      workflowId: String(payload.workflowId),
      sealed: bytes(String(payload.sealed)),
      recipientPublicKey: bytes(String(payload.publicKey)),
      recipientPrivateKey: bytes(String(payload.privateKey)),
    });
    try {
      const envelope = await ownerEnvelope(
        String(payload.newPassword),
        vaultKey,
        String(payload.vaultId),
      );
      const proofs = await createRecoveryReplacementProofsV1({
        workflowId: String(payload.workflowId),
        vaultId: String(payload.vaultId),
        vaultKey,
        sealedVaultKeyDigest: bytes(String(payload.sealedVaultKeyDigest)),
        newPassword: String(payload.newPassword),
        envelope,
      });
      return {
        envelope: { ...envelope, ownerEnvelopeProof: proofs.ownerEnvelopeProof },
        vaultKeyProof: proofs.vaultKeyProof,
      };
    } finally {
      vaultKey.fill(0);
    }
  }
  throw new Error(`尚未为 ${operation} 提供工作线程实现`);
}

scope.onmessage = async (event: MessageEvent<RequestMessage>) => {
  const { id, operation, payload } = event.data;
  try {
    scope.postMessage({ id, result: await execute(operation, payload) });
  } catch (error) {
    scope.postMessage({ id, error: error instanceof Error ? error.message : "密码学操作失败" });
  }
};
