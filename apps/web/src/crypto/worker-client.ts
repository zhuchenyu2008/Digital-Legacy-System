export const cryptoOperations = [
  "createOwnerVault",
  "unwrapOwnerVault",
  "createContactKeys",
  "rewrapOwnerVault",
  "rewrapContactPrivateKey",
  "createShareGeneration",
  "openRecoveryVault",
] as const;

export type CryptoOperation = (typeof cryptoOperations)[number];

export type CryptoWorkerLike = Pick<Worker, "postMessage" | "terminate" | "onmessage" | "onerror">;

type WorkerResponse = Readonly<{ id: string; result?: unknown; error?: string }>;

export class CryptoWorkerClient {
  public constructor(
    private readonly createWorker: () => CryptoWorkerLike = () => new Worker(new URL("./crypto.worker.ts", import.meta.url), { type: "module" }),
    private readonly createId: () => string = () => crypto.randomUUID(),
  ) {}

  public run<T>(operation: CryptoOperation, payload: unknown, sensitive: readonly Uint8Array[] = []): Promise<T> {
    const worker = this.createWorker();
    const id = this.createId();
    const transferableCopies = sensitive.map((value) => value.slice());
    return new Promise<T>((resolve, reject) => {
      const finish = () => {
        for (const value of sensitive) value.fill(0);
        worker.terminate();
      };
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        if (event.data.id !== id) return;
        finish();
        if (event.data.error) reject(new Error(event.data.error));
        else resolve(event.data.result as T);
      };
      worker.onerror = (event) => {
        finish();
        reject(new Error(event.message || "密码学工作线程执行失败"));
      };
      worker.postMessage({ id, operation, payload }, transferableCopies.map((value) => value.buffer));
    });
  }
}

export function createCryptoWorkerClient(): CryptoWorkerClient {
  return new CryptoWorkerClient();
}
