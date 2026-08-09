/// <reference lib="webworker" />
import { encryptStream, encodeBase64Url, generateVaultKey } from "@dls/crypto/browser";

const scope = self as unknown as DedicatedWorkerGlobalScope;
async function* fileChunks(file: File): AsyncIterable<Uint8Array> { const reader = file.stream().getReader(); try { for (;;) { const { done, value } = await reader.read(); if (done) break; if (value) yield new Uint8Array(value); } } finally { reader.releaseLock(); } }

scope.onmessage = async (event: MessageEvent<{ file: File; vaultId: string; packageId: string; packageVersion: number }>) => {
  const { file, vaultId, packageId, packageVersion } = event.data;
  if (!file.name.toLowerCase().endsWith(".zip")) { scope.postMessage({ type: "error", message: "仅支持 ZIP 文件" }); return; }
  const signature = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (!(signature[0] === 0x50 && signature[1] === 0x4b)) { scope.postMessage({ type: "error", message: "文件不是有效 ZIP" }); return; }
  const key = await generateVaultKey(); const chunks: Uint8Array[] = [];
  try {
    const manifest = await encryptStream({ key, context: { vaultId, packageId, packageVersion }, chunks: fileChunks(file), onChunk(chunk) { chunks.push(chunk); scope.postMessage({ type: "progress", plaintextBytes: file.size, encryptedChunks: chunks.length }); } });
    const blob = new Blob(chunks.map((chunk) => chunk.slice().buffer), { type: "application/octet-stream" });
    for (const chunk of chunks) chunk.fill(0);
    scope.postMessage({ type: "prepared", manifest, ciphertext: blob, dek: encodeBase64Url(key) });
  } catch (error) { scope.postMessage({ type: "error", message: error instanceof Error ? error.message : "加密失败" }); }
  finally { key.fill(0); signature.fill(0); for (const chunk of chunks) chunk.fill(0); }
};
