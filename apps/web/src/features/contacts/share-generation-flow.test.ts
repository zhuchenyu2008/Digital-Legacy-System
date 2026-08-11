import { describe, expect, test } from "vitest";
import { runShareGenerationFlow } from "./share-generation-flow.js";

describe("share generation browser flow", () => {
  test("unlocks in the crypto worker, uploads both share sets, and activates the draft", async () => {
    const calls: Array<Readonly<{ path: string; init?: RequestInit }>> = [];
    const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
      calls.push({ path, ...(init === undefined ? {} : { init }) });
      if (path === "/owner/vault/material") {
        return {
          vaultId: "vault-1",
          activeShareGenerationId: "generation-6",
          contactSetVersion: 4,
          ownerVaultEnvelope: { ciphertext: "cipher", nonce: "nonce", kdfSalt: "salt" },
        } as T;
      }
      if (path === "/owner/vault/share-generations") {
        return {
          generationId: "generation-7",
          deathThreshold: 2,
          recoveryThreshold: 2,
          contactsSnapshotSha256: "ab".repeat(32),
          contacts: [
            { contactId: "contact-1", publicKey: "key-1" },
            { contactId: "contact-2", publicKey: "key-2" },
            { contactId: "contact-3", publicKey: "key-3" },
          ],
        } as T;
      }
      if (path.endsWith("/activate")) {
        return { generationId: "generation-7", status: "ACTIVE", systemState: "READY" } as T;
      }
      return { generationId: "generation-7", status: "PREPARING" } as T;
    };
    const workerInputs: unknown[] = [];

    const result = await runShareGenerationFlow("owner-password-2026", {
      request,
      buildUpload: async (input) => {
        workerInputs.push(input);
        return {
          contactSetVersion: 4,
          contactsSnapshotSha256: "ab".repeat(32),
          protocolVersion: 1,
          vssScheme: "AUDITED_PUBLICLY_VERIFIABLE_SHARING_V1",
          generationCommitment: "commitment",
          vkCommitment: "cd".repeat(32),
          generationProof: "proof",
          shares: [],
        };
      },
      idFactory: (() => {
        let index = 0;
        return () => `request-${++index}`;
      })(),
    });

    expect(result).toEqual({
      generationId: "generation-7",
      status: "ACTIVE",
      systemState: "READY",
    });
    expect(workerInputs).toEqual([
      expect.objectContaining({
        password: "owner-password-2026",
        envelope: { ciphertext: "cipher", nonce: "nonce", kdfSalt: "salt" },
        vaultId: "vault-1",
        generationId: "generation-7",
        contactSetVersion: 4,
      }),
    ]);
    expect(calls.map((call) => call.path)).toEqual([
      "/owner/vault/material",
      "/owner/vault/share-generations",
      "/owner/vault/share-generations/generation-7/upload",
      "/owner/vault/share-generations/generation-7/activate",
    ]);
    expect(calls.map((call) => call.init?.body ?? "").join("\n")).not.toContain(
      "owner-password-2026",
    );
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({
      vaultId: "vault-1",
      contactSetVersion: 4,
      expectedCurrentGenerationId: "generation-6",
    });
    expect(JSON.parse(String(calls[3]?.init?.body))).toEqual({
      contactSetVersion: 4,
      expectedCurrentGenerationId: "generation-6",
    });
  });
});
