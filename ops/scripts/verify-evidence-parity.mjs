import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const run = promisify(execFile);
const hostArgument = process.argv.indexOf("--host");
const hostPath = resolve(
  root,
  hostArgument >= 0
    ? (process.argv[hostArgument + 1] ?? "docs/acceptance/local-v1-evidence.md")
    : "docs/acceptance/local-v1-evidence.md",
);
const host = await readFile(hostPath, "utf8");
const metadata = JSON.parse(
  (
    await run(process.execPath, ["ops/scripts/release-metadata.mjs"], {
      cwd: root,
      encoding: "utf8",
    })
  ).stdout,
);
const expected = {
  "Protocol SHA-256": metadata.hashes?.protocolSha256,
  "Vectors SHA-256": metadata.hashes?.vectorsSha256,
  "Application SHA-256": metadata.hashes?.applicationSha256,
};

for (const [label, value] of Object.entries(expected)) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) {
    throw new Error(`release metadata is missing ${label}`);
  }
  if (!host.includes(`${label}: \`${value}\``)) {
    throw new Error(`host evidence hash does not match ${label}`);
  }
}

process.stdout.write(`${JSON.stringify({ matched: true, hashes: metadata.hashes })}\n`);
