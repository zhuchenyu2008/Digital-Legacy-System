import { encodeBase64Url, generateContactKeyPair } from "@dls/crypto/browser";
import { describe, expect, test } from "vitest";
import { buildShareGenerationUpload } from "./share-generation";

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
    expect(
      result.shares.every((share) => share.deathShareCiphertext !== share.recoveryShareCiphertext),
    ).toBe(true);
  });
});
