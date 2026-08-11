import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const required = [
  "apps/api/dist/main.js",
  "apps/worker/dist/main.js",
  "apps/web/.next/BUILD_ID",
  "packages/application/dist/index.js",
  "packages/vss-wasm/dist/SHA256SUMS.json",
];

for (const relativePath of required) {
  const metadata = await stat(resolve(root, relativePath));
  if (!metadata.isFile() || metadata.size === 0) {
    throw new Error(`required build artifact is empty: ${relativePath}`);
  }
}

const wasmManifest = JSON.parse(
  await readFile(resolve(root, "packages/vss-wasm/dist/SHA256SUMS.json"), "utf8"),
);
if (typeof wasmManifest !== "object" || wasmManifest === null || Object.keys(wasmManifest).length === 0) {
  throw new Error("WASM checksum manifest is empty");
}

process.stdout.write(`${JSON.stringify({ verified: required })}\n`);
