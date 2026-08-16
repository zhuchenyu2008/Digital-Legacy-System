import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

function option(name) {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? undefined : process.argv[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`${name} is required`);
  return value;
}

const target = resolve(option("--file"));
const status = option("--status");
const kind = option("--kind");
if (!/^[a-z][a-z-]{1,31}$/u.test(kind)) throw new Error("operation kind is invalid");
if (status !== "ok" && status !== "failed") throw new Error("operation status is invalid");
const value = {
  version: 1,
  kind,
  status,
  startedAt: option("--started-at"),
  completedAt: new Date().toISOString(),
  ...(process.argv.includes("--artifact") ? { artifact: option("--artifact") } : {}),
  ...(process.argv.includes("--secret-artifact")
    ? { secretArtifact: option("--secret-artifact") }
    : {}),
};
await mkdir(dirname(target), { recursive: true });
const temporary = `${target}.${process.pid}.tmp`;
await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
await rename(temporary, target);
