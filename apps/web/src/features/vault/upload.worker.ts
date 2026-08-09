/// <reference lib="webworker" />
import { encryptStream, generateVaultKey } from "@dls/crypto/browser";
import { type CiphertextWriter, createOpfsCiphertextStore } from "./opfs-ciphertext-store";

const scope = self as unknown as DedicatedWorkerGlobalScope;
async function* fileChunks(file: File): AsyncIterable<Uint8Array> {
  const reader = file.stream().getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) yield new Uint8Array(value);
    }
  } finally {
    reader.releaseLock();
  }
}

let activeStore: CiphertextWriter | undefined;

scope.onmessage = async (
  event: MessageEvent<{
    type?: "prepare" | "cleanup";
    file?: File;
    vaultId?: string;
    packageId?: string;
    packageVersion?: number;
  }>,
) => {
  if (event.data.type === "cleanup") {
    await activeStore?.cleanup();
    activeStore = undefined;
    scope.postMessage({ type: "cleaned" });
    return;
  }
  const { file, vaultId, packageId, packageVersion } = event.data;
  const version = Number(packageVersion);
  if (!file || !vaultId || !packageId || !Number.isSafeInteger(version)) {
    scope.postMessage({ type: "error", message: "缺少加密上传上下文" });
    return;
  }
  if (!file.name.toLowerCase().endsWith(".zip")) {
    scope.postMessage({ type: "error", message: "仅支持 ZIP 文件" });
    return;
  }
  const signature = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (!(signature[0] === 0x50 && signature[1] === 0x4b)) {
    scope.postMessage({ type: "error", message: "文件不是有效 ZIP" });
    return;
  }
  const key = await generateVaultKey();
  const temporaryName = `dls-ciphertext-${crypto.randomUUID()}.bin`;
  try {
    await activeStore?.cleanup();
    activeStore = await createOpfsCiphertextStore(temporaryName);
    let encryptedChunks = 0;
    const manifest = await encryptStream({
      key,
      context: { vaultId, packageId, packageVersion: version },
      chunks: fileChunks(file),
      async onChunk(chunk) {
        await activeStore?.write(chunk);
        encryptedChunks += 1;
        scope.postMessage({ type: "progress", plaintextBytes: file.size, encryptedChunks });
      },
    });
    const ciphertext = await activeStore.close();
    scope.postMessage({ type: "prepared", manifest, ciphertext, temporaryName });
  } catch (error) {
    await activeStore?.abort().catch(() => undefined);
    activeStore = undefined;
    scope.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : "加密失败",
    });
  } finally {
    key.fill(0);
    signature.fill(0);
  }
};
