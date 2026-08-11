import type { CryptoWorkerLike } from "./worker-client";

export type RecoveryCryptoWorkerLike = CryptoWorkerLike;

type WorkerResponse = Readonly<{ id: string; result?: unknown; error?: string }>;

type RecoveryMaterialResult = Readonly<{
  envelope: Readonly<Record<string, unknown>>;
  vaultKeyProof: string;
}>;

export class RecoveryCryptoWorkerSession {
  readonly #worker: RecoveryCryptoWorkerLike;
  readonly #createId: () => string;
  #closed = false;

  public constructor(
    createWorker: () => RecoveryCryptoWorkerLike = () =>
      new Worker(new URL("./crypto.worker.ts", import.meta.url), { type: "module" }),
    createId: () => string = () => crypto.randomUUID(),
  ) {
    this.#worker = createWorker();
    this.#createId = createId;
  }

  public async createEphemeralKey(): Promise<string> {
    return this.run<{ publicKey: string }>("createRecoveryEphemeralKey", {}).then(
      (result) => result.publicKey,
    );
  }

  public async openRecoveryVault(
    input: Readonly<{
      workflowId: string;
      vaultId: string;
      sealed: string;
      sealedVaultKeyDigest: string;
      newPassword: string;
    }>,
  ): Promise<RecoveryMaterialResult> {
    const result = await this.run<RecoveryMaterialResult>("openRecoveryVault", input);
    this.close();
    return result;
  }

  public close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#worker.terminate();
  }

  private run<T>(operation: string, payload: unknown): Promise<T> {
    if (this.#closed) return Promise.reject(new Error("recovery crypto session is closed"));
    const id = this.#createId();
    return new Promise<T>((resolve, reject) => {
      this.#worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        if (event.data.id !== id) return;
        if (event.data.error !== undefined) reject(new Error(event.data.error));
        else resolve(event.data.result as T);
      };
      this.#worker.onerror = (event) =>
        reject(new Error(event.message || "recovery crypto failed"));
      this.#worker.postMessage({ id, operation, payload });
    });
  }
}
