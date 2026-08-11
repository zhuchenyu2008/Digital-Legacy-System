import { decodeBase64Url, encodeBase64Url, generateContactKeyPair } from "@dls/crypto/browser";
import { describe, expect, test } from "vitest";
import {
  buildShareGenerationUpload,
  buildShareGenerationUploadFromOwnerEnvelope,
} from "./share-generation";

describe("browser share generation", () => {
  test("isolates death and recovery VSS contexts and emits an uploadable payload", async () => {
    const contacts = await Promise.all(
      ["contact-1", "contact-2", "contact-3"].map(async (contactId) => {
        const pair = await generateContactKeyPair();
        pair.privateKey.fill(0);
        return { contactId, publicKey: encodeBase64Url(pair.publicKey) };
      }),
    );
    const contexts: string[] = [];
    const result = await buildShareGenerationUpload(
      {
        vaultKey: encodeBase64Url(new Uint8Array(32).fill(7)),
        vaultId: "vault-1",
        generationId: "generation-1",
        contactSetVersion: 4,
        contactsSnapshotSha256: "ab".repeat(32),
        deathThreshold: 3,
        recoveryThreshold: 2,
        contacts,
      },
      {
        initialize: async () => undefined,
        split: (_secret, threshold, shareCount, context) => {
          contexts.push(new TextDecoder().decode(context));
          return {
            shares: Array.from({ length: shareCount }, (_, index) =>
              new Uint8Array(34).fill(index + threshold),
            ),
            commitments: new Uint8Array(32).fill(threshold),
          };
        },
      },
    );

    expect(contexts).toHaveLength(2);
    expect(contexts[0]).toContain('"purpose":"DEATH"');
    expect(contexts[1]).toContain('"purpose":"RECOVERY"');
    expect(result).toMatchObject({
      contactSetVersion: 4,
      contactsSnapshotSha256: "ab".repeat(32),
      protocolVersion: 1,
      vssScheme: "AUDITED_PUBLICLY_VERIFIABLE_SHARING_V1",
    });
    expect(result.vkCommitment).toMatch(/^[0-9a-f]{64}$/u);
    expect(result.shares).toHaveLength(3);
    expect(decodeBase64Url(result.shares[0]?.deathShareCommitment ?? "")).toEqual(
      new Uint8Array(32).fill(3),
    );
    expect(decodeBase64Url(result.shares[0]?.recoveryShareCommitment ?? "")).toEqual(
      new Uint8Array(32).fill(2),
    );
    expect(
      result.shares.every((share) => share.deathShareCiphertext !== share.recoveryShareCiphertext),
    ).toBe(true);
  });

  test("unwraps the owner vault inside the worker flow and clears the plaintext key", async () => {
    const contacts = await Promise.all(
      ["contact-1", "contact-2", "contact-3"].map(async (contactId) => {
        const pair = await generateContactKeyPair();
        pair.privateKey.fill(0);
        return { contactId, publicKey: encodeBase64Url(pair.publicKey) };
      }),
    );
    const plaintextVaultKey = new Uint8Array(32).fill(9);

    const result = await buildShareGenerationUploadFromOwnerEnvelope(
      {
        password: "owner-password-2026",
        envelope: { ciphertext: "ciphertext" },
        vaultId: "vault-1",
        generationId: "generation-2",
        contactSetVersion: 4,
        contactsSnapshotSha256: "cd".repeat(32),
        deathThreshold: 2,
        recoveryThreshold: 2,
        contacts,
      },
      {
        unwrapOwnerVault: async ({ password, vaultId }) => {
          expect(password).toBe("owner-password-2026");
          expect(vaultId).toBe("vault-1");
          return plaintextVaultKey;
        },
        shareGeneration: {
          initialize: async () => undefined,
          split: (_secret, threshold, shareCount) => ({
            shares: Array.from({ length: shareCount }, (_, index) =>
              new Uint8Array(34).fill(index + threshold),
            ),
            commitments: new Uint8Array(32).fill(threshold),
          }),
        },
      },
    );

    expect(result.shares).toHaveLength(3);
    expect(plaintextVaultKey.every((value) => value === 0)).toBe(true);
  });
});
