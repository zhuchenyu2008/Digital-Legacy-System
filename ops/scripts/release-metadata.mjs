import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { arch, platform } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveCorepackCli } from "./toolchain-runtime.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const applicationInputs = [
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "Cargo.toml",
  "Cargo.lock",
  "rust-toolchain.toml",
  "apps/api/package.json",
  "apps/api/src",
  "apps/worker/package.json",
  "apps/worker/src",
  "apps/web/package.json",
  "apps/web/src",
  "packages/application/package.json",
  "packages/application/src",
  "packages/contracts/package.json",
  "packages/contracts/openapi",
  "packages/contracts/src",
  "packages/crypto/package.json",
  "packages/crypto/src",
  "packages/domain/package.json",
  "packages/domain/src",
  "packages/email-templates/package.json",
  "packages/email-templates/src",
  "packages/persistence/migrations",
  "packages/persistence/package.json",
  "packages/persistence/src",
  "packages/storage/package.json",
  "packages/storage/src",
  "packages/vss-wasm/Cargo.toml",
  "packages/vss-wasm/package.json",
  "packages/vss-wasm/src",
];

function normalizedText(value) {
  return value.replace(/\r\n?/gu, "\n");
}

async function filesBelow(relativePath) {
  const absolutePath = resolve(root, relativePath);
  const metadata = await stat(absolutePath);
  if (metadata.isFile()) return [relativePath.replaceAll("\\", "/")];
  const entries = await readdir(absolutePath, { withFileTypes: true });
  const nested = await Promise.all(
    entries
      .filter((entry) => !entry.name.includes(".test.") && !entry.name.includes(".spec."))
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((entry) => filesBelow(`${relativePath}/${entry.name}`)),
  );
  return nested.flat();
}

async function treeSha256(inputs) {
  const files = (await Promise.all(inputs.map((input) => filesBelow(input)))).flat().sort();
  const hash = createHash("sha256");
  for (const file of files) {
    const content = normalizedText(await readFile(resolve(root, file), "utf8"));
    hash.update(`${file.length}:${file}\0${Buffer.byteLength(content, "utf8")}:`);
    hash.update(content, "utf8");
    hash.update("\0");
  }
  return hash.digest("hex");
}

function match(text, pattern, description) {
  const value = text.match(pattern)?.[1];
  if (!value) throw new Error(`release metadata is missing ${description}`);
  return value;
}

const [packageText, nodeVersionText, rustToolchain, dockerfile, compose, trivy, migrationFiles] =
  await Promise.all([
    readFile(resolve(root, "package.json"), "utf8"),
    readFile(resolve(root, ".node-version"), "utf8"),
    readFile(resolve(root, "rust-toolchain.toml"), "utf8"),
    readFile(resolve(root, "Dockerfile"), "utf8"),
    readFile(resolve(root, "compose.yaml"), "utf8"),
    readFile(resolve(root, "ops/security/trivy.yaml"), "utf8"),
    readdir(resolve(root, "packages/persistence/migrations")),
  ]);

const packageJson = JSON.parse(packageText);
const nodeVersion = String(packageJson.engines?.node ?? "");
const packageManager = String(packageJson.packageManager ?? "");
const pnpmVersion = match(packageManager, /^pnpm@(.+)$/u, "pnpm version");
const rustVersion = match(rustToolchain, /channel\s*=\s*"([^"]+)"/u, "Rust version");
const rustImageVersion = match(dockerfile, /ARG RUST_IMAGE=rust:([^-@]+)/u, "Rust image version");
const migrationUp = migrationFiles
  .map((name) => name.match(/^(\d{3})_.+\.up\.sql$/u)?.[1])
  .filter(Boolean)
  .sort();
const migrationVersion = migrationUp.at(-1);
if (!migrationVersion) throw new Error("release metadata has no database migration");
if (!migrationFiles.some((name) => name.startsWith(`${migrationVersion}_`) && name.endsWith(".down.sql"))) {
  throw new Error(`migration ${migrationVersion} has no down rehearsal pair`);
}

const protocolSources = await Promise.all([
  readFile(resolve(root, "packages/crypto/src/workflows/fragment-ingress.ts"), "utf8"),
  readFile(resolve(root, "packages/crypto/src/workflows/stage-wrapping.ts"), "utf8"),
  readFile(resolve(root, "ops/scripts/backup.ps1"), "utf8"),
]);
const protocolVersion = match(protocolSources[0], /protocolVersion:\s*z\.literal\((\d+)\)/u, "protocol version");
for (const source of protocolSources.slice(1)) {
  if (!new RegExp(`(?:z\\.literal\\(|protocolVersion\\s*=\\s*)${protocolVersion}`).test(source)) {
    throw new Error("release protocol versions are inconsistent");
  }
}

const imagePins = [
  ...dockerfile.matchAll(/^ARG [A-Z_]+_IMAGE=([^\r\n]+)$/gmu),
  ...compose.matchAll(/^\s*image:\s*([^\r\n]+)$/gmu),
].map((entry) => entry[1].trim());
const trivyImage = match(trivy, /^image:\s*(\S+)/mu, "Trivy image");
const trivyDigest = match(trivy, /^digest:\s*"(sha256:[0-9a-f]{64})"/mu, "Trivy digest");
imagePins.push(`${trivyImage}@${trivyDigest}`);
const minioVersion = match(
  dockerfile,
  /org\.opencontainers\.image\.version="([^"]+)"/u,
  "MinIO source version",
);
const minioSourceDigest = match(
  dockerfile,
  /ARG MINIO_SOURCE_SHA256=([0-9a-f]{64})/u,
  "MinIO source digest",
);
imagePins.push(`minio-source:${minioVersion}@sha256:${minioSourceDigest}`);
for (const image of imagePins) {
  if (!/@sha256:[0-9a-f]{64}$/u.test(image)) throw new Error(`release image is not digest-pinned: ${image}`);
}

if (nodeVersionText.trim() !== nodeVersion) throw new Error("package.json and .node-version disagree");
if (rustImageVersion !== rustVersion) throw new Error("rust-toolchain.toml and Rust image disagree");

const metadata = {
  system: { os: platform(), architecture: arch() },
  tools: { node: nodeVersion, pnpm: pnpmVersion, rust: rustVersion },
  migrationVersion,
  protocolVersion,
  images: [...new Set(imagePins)].sort(),
  hashes: {
    protocolSha256: await treeSha256(["docs/security/cryptographic-protocol-v1.md"]),
    vectorsSha256: await treeSha256(["packages/vss-wasm/vectors"]),
    applicationSha256: await treeSha256(applicationInputs),
  },
};

if (process.argv.includes("--verify")) {
  if (process.version !== `v${nodeVersion}`) {
    throw new Error(`Node ${nodeVersion} is required; found ${process.version}`);
  }
  const corepackCli = resolveCorepackCli();
  const actualPnpm = execFileSync(process.execPath, [corepackCli, "pnpm", "--version"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  if (actualPnpm !== pnpmVersion) throw new Error(`pnpm ${pnpmVersion} is required; found ${actualPnpm}`);
}

process.stdout.write(`${JSON.stringify(metadata)}\n`);
