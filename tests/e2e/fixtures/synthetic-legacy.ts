import { createHash } from "node:crypto";
import { encryptStream, type StreamManifest } from "../../../packages/crypto/dist/node.js";
import { bytes, createZip } from "../../../packages/storage/src/archive/test-zip.js";
import { SYNTHETIC_BINARY, SYNTHETIC_WILL } from "./synthetic-content.js";

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

async function* oneChunk(value: Uint8Array): AsyncGenerator<Uint8Array> {
  yield value;
}

export type SyntheticLegacy = Readonly<{
  archive: Uint8Array;
  archiveSha256: string;
  encrypted: Readonly<{ ciphertext: Uint8Array; manifest: StreamManifest }>;
}>;

export async function createSyntheticLegacy(vaultKey: Uint8Array): Promise<SyntheticLegacy> {
  const archive = createZip([
    { name: "will.md", body: bytes(SYNTHETIC_WILL), method: 8 },
    { name: "attachments/proof.bin", body: SYNTHETIC_BINARY },
  ]);
  const chunks: Uint8Array[] = [];
  const manifest = await encryptStream({
    key: vaultKey,
    context: {
      vaultId: "00000000-0000-4000-8000-00000000e001",
      packageId: "00000000-0000-4000-8000-00000000e004",
      packageVersion: 1,
    },
    chunks: oneChunk(archive),
    onChunk: (chunk) => chunks.push(chunk),
  });
  const ciphertext = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    ciphertext.set(chunk, offset);
    offset += chunk.length;
  }
  return Object.freeze({
    archive,
    archiveSha256: sha256(archive),
    encrypted: Object.freeze({ ciphertext, manifest }),
  });
}
