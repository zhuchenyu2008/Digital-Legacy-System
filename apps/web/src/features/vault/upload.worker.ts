/// <reference lib="webworker" />
import {
  canonicalizeAad,
  decodeBase64Url,
  deriveBrowserKey,
  encodeBase64Url,
  encryptPackageManifestV1,
  encryptStream,
  generateVaultKey,
  unwrapKeyV1,
  wrapKeyV1,
} from "@dls/crypto/browser";
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

function hex(value: Uint8Array): string {
  return [...value].map((item) => item.toString(16).padStart(2, "0")).join("");
}

async function unwrapOwnerVault(
  password: string,
  envelope: Readonly<Record<string, unknown>>,
  vaultId: string,
): Promise<Uint8Array> {
  const wrappingKey = await deriveBrowserKey(password, {
    version: 1,
    algorithm: "argon2id13",
    opsLimit: 3,
    memLimit: 64 * 1024 * 1024,
    salt: String(envelope.kdfSalt),
    outputBytes: 32,
  });
  try {
    return await unwrapKeyV1({
      envelope: {
        version: 1,
        algorithm: "xchacha20poly1305-ietf",
        purpose: "owner-vk",
        keyId: "owner-vk",
        nonce: String(envelope.nonce),
        ciphertext: String(envelope.ciphertext),
      },
      wrappingKey,
      aad: {
        protocol: "dls-crypto-v1",
        version: 1,
        purpose: "owner-vk",
        vaultId,
        keyId: "owner-vk",
        algorithm: "xchacha20poly1305-ietf",
      },
    });
  } finally {
    wrappingKey.fill(0);
  }
}

scope.onmessage = async (
  event: MessageEvent<{
    type?: "prepare" | "cleanup";
    file?: File;
    password?: string;
    envelope?: Readonly<Record<string, unknown>>;
    shareGenerationId?: string;
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
  const { file, password, envelope, vaultId, shareGenerationId, packageId, packageVersion } =
    event.data;
  const version = Number(packageVersion);
  if (
    !file ||
    !password ||
    !envelope ||
    !vaultId ||
    !shareGenerationId ||
    !packageId ||
    !Number.isSafeInteger(version)
  ) {
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
  const vaultKey = await unwrapOwnerVault(password, envelope, vaultId);
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
    const packageAad = {
      protocol: "dls-crypto-v1",
      version: 1,
      purpose: "package-dek" as const,
      keyId: `package-kek-${version}`,
      vaultId,
      packageId,
      packageVersion: version,
      algorithm: "xchacha20poly1305-ietf",
    };
    const dekEnvelope = await wrapKeyV1({
      key,
      wrappingKey: vaultKey,
      aad: packageAad,
    });
    const encryptedManifest = await encryptPackageManifestV1({
      key,
      context: { vaultId, packageId, packageVersion: version },
      manifest,
    });
    const ciphertextSha256 = hex(decodeBase64Url(manifest.ciphertextSha256));
    const packageAadBytes = canonicalizeAad(packageAad);
    const packageAadHash = new Uint8Array(
      await crypto.subtle.digest("SHA-256", packageAadBytes as BufferSource),
    );
    scope.postMessage({
      type: "prepared",
      temporaryName,
      prepared: {
        ciphertext,
        streamHeader: manifest.streamHeader,
        ciphertextSize: manifest.ciphertextBytes,
        ciphertextSha256,
        dekEnvelope: dekEnvelope.ciphertext,
        dekEnvelopeNonce: dekEnvelope.nonce,
        dekEnvelopeAlgorithm: dekEnvelope.algorithm,
        dekEnvelopeProtocolVersion: 1,
        dekEnvelopeAadHash: encodeBase64Url(packageAadHash),
        manifestCiphertext: encodeBase64Url(encryptedManifest.ciphertext),
        manifestNonce: encodeBase64Url(encryptedManifest.nonce),
        manifestAlgorithm: encryptedManifest.algorithm,
        manifestAadHash: encodeBase64Url(encryptedManifest.aadHash),
        clientCryptoVersion: "dls-web-package-v1",
      },
    });
    packageAadBytes.fill(0);
    packageAadHash.fill(0);
  } catch (error) {
    await activeStore?.abort().catch(() => undefined);
    activeStore = undefined;
    scope.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : "加密失败",
    });
  } finally {
    vaultKey.fill(0);
    key.fill(0);
    signature.fill(0);
  }
};
