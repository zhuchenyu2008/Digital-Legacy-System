import { describe, expect, test } from "vitest";
import {
  type RecoveryCryptoWorkerLike,
  RecoveryCryptoWorkerSession,
} from "./recovery-worker-session";

class FakeWorker implements RecoveryCryptoWorkerLike {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly messages: unknown[] = [];
  terminated = false;

  postMessage(message: unknown): void {
    this.messages.push(message);
    const input = message as { id: string; operation: string };
    queueMicrotask(() => {
      const result =
        input.operation === "createRecoveryEphemeralKey"
          ? { publicKey: "ephemeral-public" }
          : { envelope: { ciphertext: "replacement" }, vaultKeyProof: "proof" };
      this.onmessage?.({ data: { id: input.id, result } } as MessageEvent);
    });
  }

  terminate(): void {
    this.terminated = true;
  }
}

describe("RecoveryCryptoWorkerSession", () => {
  test("keeps the ephemeral private key in one worker across material and reset preparation", async () => {
    const worker = new FakeWorker();
    const session = new RecoveryCryptoWorkerSession(
      () => worker,
      (() => {
        let sequence = 0;
        return () => `recovery-${++sequence}`;
      })(),
    );

    await expect(session.createEphemeralKey()).resolves.toBe("ephemeral-public");
    await expect(
      session.openRecoveryVault({
        workflowId: "workflow-1",
        vaultId: "vault-1",
        sealed: "sealed-material",
        sealedVaultKeyDigest: "sealed-digest",
        newPassword: "new-password-1234",
      }),
    ).resolves.toEqual({ envelope: { ciphertext: "replacement" }, vaultKeyProof: "proof" });

    expect(worker.messages).toHaveLength(2);
    expect(worker.messages[1]).not.toHaveProperty("privateKey");
    expect(worker.terminated).toBe(true);
  });
});
