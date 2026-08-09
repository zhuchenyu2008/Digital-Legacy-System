import { describe, expect, it } from "vitest";
import {
  createRecoveryReplacementProofsV1,
  verifyRecoveryReplacementProofsV1,
} from "./recovery-replacement-proof.js";

const envelope = {
  ciphertext: "ciphertext",
  nonce: "nonce",
  kdfSalt: "salt",
  kdfParams: {
    algorithm: "argon2id" as const,
    memoryKiB: 65_536,
    iterations: 3,
    parallelism: 1,
    version: 19,
    purpose: "owner-vault-kek-v1" as const,
  },
  keyVerifierCiphertext: "verifier",
  keyVerifierNonce: "verifier-nonce",
  vkCommitment: "ab".repeat(32),
};

describe("recovery replacement proofs", () => {
  it("binds the password, replacement envelope, workflow, vault, and sealed VK digest", async () => {
    const input = {
      workflowId: "workflow-1",
      vaultId: "vault-1",
      vaultKey: new Uint8Array(32).fill(7),
      sealedVaultKeyDigest: new Uint8Array(32).fill(8),
      newPassword: "a-new-owner-password",
      envelope,
    };
    const proofs = await createRecoveryReplacementProofsV1(input);

    await expect(verifyRecoveryReplacementProofsV1({ ...input, ...proofs })).resolves.toBe(true);
    expect(
      await verifyRecoveryReplacementProofsV1({
        ...input,
        newPassword: "a-different-password",
        ...proofs,
      }),
    ).toBe(false);
    expect(
      await verifyRecoveryReplacementProofsV1({
        ...input,
        sealedVaultKeyDigest: new Uint8Array(32).fill(9),
        ...proofs,
      }),
    ).toBe(false);
  });
});
