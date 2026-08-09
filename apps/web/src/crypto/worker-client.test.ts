import { describe, expect, test } from "vitest";
import { CryptoWorkerClient, type CryptoWorkerLike, cryptoOperations } from "./worker-client";

class FakeWorker implements CryptoWorkerLike {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  posted?: { message: unknown; transfer: Transferable[] };
  terminated = false;

  postMessage(message: unknown, transfer: Transferable[] = []): void {
    this.posted = { message, transfer };
    queueMicrotask(() =>
      this.onmessage?.({
        data: { id: (message as { id: string }).id, result: { ok: true } },
      } as MessageEvent),
    );
  }

  terminate(): void {
    this.terminated = true;
  }
}

describe("CryptoWorkerClient", () => {
  test("offers a dedicated contact-fragment operation instead of mixing workflow purposes in UI code", () => {
    expect(cryptoOperations).toContain("createContactFragment");
  });

  test("uses request IDs, transfers owned buffers, zeroes them, and terminates after success", async () => {
    const worker = new FakeWorker();
    const sensitive = new Uint8Array([1, 2, 3, 4]);
    const client = new CryptoWorkerClient(
      () => worker,
      () => "request-1",
    );

    await expect(
      client.run("unwrapOwnerVault", { envelope: "opaque" }, [sensitive]),
    ).resolves.toEqual({ ok: true });
    expect(worker.posted?.message).toMatchObject({
      id: "request-1",
      operation: "unwrapOwnerVault",
    });
    expect(worker.posted?.transfer).toEqual([sensitive.buffer]);
    expect([...sensitive]).toEqual([0, 0, 0, 0]);
    expect(worker.terminated).toBe(true);
  });
});
