import { readdir } from "node:fs/promises";
import { resolve } from "node:path";

const migrationsDirectory = resolve(process.cwd(), "packages/persistence/migrations");
const files = (await readdir(migrationsDirectory)).filter((name) => name.endsWith(".sql")).sort();
const migrations = new Map();

for (const file of files) {
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

const versions = [...migrations.keys()].map(Number).sort((left, right) => left - right);
if (versions.length === 0 || files.length !== versions.length * 2) {
  throw new Error("runtime migration directory must contain paired up/down SQL files");
}
for (let index = 0; index < versions.length; index += 1) {
  const version = versions[index];
  if (version !== index + 1) {
    throw new Error(`runtime migration versions are not continuous at ${String(index + 1).padStart(3, "0")}`);
  }
  const entry = migrations.get(String(version).padStart(3, "0"));
  if (entry?.directions.size !== 2) {
    throw new Error(`runtime migration ${String(version).padStart(3, "0")} is missing up/down SQL`);
  }
}

process.stdout.write(`${JSON.stringify({ migrationFiles: files, latestVersion: versions.at(-1) })}\n`);
