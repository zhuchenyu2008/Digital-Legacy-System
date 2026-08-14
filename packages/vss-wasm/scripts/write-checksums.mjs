import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const distDir = resolve(import.meta.dirname, "../dist");

function hashes(directory) {
  return Object.fromEntries(
    readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort()
      .map((name) => [
        name,
        createHash("sha256").update(readFileSync(join(directory, name))).digest("hex"),
      ]),
  );
}

writeFileSync(
  join(distDir, "SHA256SUMS.json"),
  `${JSON.stringify(
    {
      browser: hashes(join(distDir, "browser")),
      node: hashes(join(distDir, "node")),
    },
    null,
    2,
  )}\n`,
  "utf8",
);
