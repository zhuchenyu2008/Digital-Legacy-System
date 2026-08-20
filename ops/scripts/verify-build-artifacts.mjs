import { readFile, readdir, stat } from "node:fs/promises";
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

const migrationsDirectory = resolve(root, "packages/persistence/migrations");
const migrationFiles = (await readdir(migrationsDirectory)).filter((name) => name.endsWith(".sql"));
const migrations = new Map();
for (const file of migrationFiles) {
  const match = /^(\d{3})_(.+)\.(up|down)\.sql$/u.exec(file);
  if (!match) throw new Error(`migration filename is invalid: ${file}`);
  const [, version, name, direction] = match;
  const entry = migrations.get(version) ?? { name, directions: new Set() };
  if (entry.name !== name || entry.directions.has(direction)) {
    throw new Error(`migration has duplicate or mismatched directions: ${file}`);
  }
  entry.directions.add(direction);
  migrations.set(version, entry);
}
const versions = [...migrations.keys()].map(Number).sort((a, b) => a - b);
for (let index = 0; index < versions.length; index += 1) {
  const expected = index + 1;
  if (versions[index] !== expected) {
    throw new Error(`migration versions must be continuous from 001; expected ${expected}, found ${versions[index]}`);
  }
  const entry = migrations.get(String(versions[index]).padStart(3, "0"));
  if (entry?.directions.size !== 2) {
    throw new Error(`migration ${String(versions[index]).padStart(3, "0")} must have both up and down SQL`);
  }
}
if (versions.length === 0 || migrationFiles.length !== versions.length * 2) {
  throw new Error("migration directory must contain paired up/down SQL files");
}

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

process.stdout.write(
  `${JSON.stringify({
    verified: [
      ...required,
      "packages/persistence/migrations",
      ...migrationFiles.sort().map((file) => `packages/persistence/migrations/${file}`),
    ],
  })}\n`,
);
