import sodium from "libsodium-wrappers-sumo";
import { describe, expect, it } from "vitest";
import { openRecoveryVaultKeyV1, sealRecoveryVaultKeyV1 } from "./recovery-sealing.js";

describe("recovery vault-key sealing", () => {
  it("round-trips only for the bound workflow and ephemeral key pair", async () => {
    await sodium.ready;
    const recipient = sodium.crypto_box_keypair();
    const other = sodium.crypto_box_keypair();
    const vaultKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);

    const sealed = await sealRecoveryVaultKeyV1({
      workflowId: "workflow-1",
      vaultKey,
      recipientPublicKey: recipient.publicKey,
    });

    await expect(
      openRecoveryVaultKeyV1({
        workflowId: "workflow-1",
        sealed,
        recipientPublicKey: recipient.publicKey,
        recipientPrivateKey: recipient.privateKey,
      }),
    ).resolves.toEqual(vaultKey);
    await expect(
      openRecoveryVaultKeyV1({
        workflowId: "workflow-2",
        sealed,
        recipientPublicKey: recipient.publicKey,
        recipientPrivateKey: recipient.privateKey,
      }),
    ).rejects.toThrow("context");
    await expect(
      openRecoveryVaultKeyV1({
        workflowId: "workflow-1",
        sealed,
        recipientPublicKey: other.publicKey,
        recipientPrivateKey: other.privateKey,
      }),
    ).rejects.toThrow();
  });
});
