import { existsSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";

export function resolveCorepackCli({
  execPath = process.execPath,
  environment = process.env,
  fileExists = existsSync,
} = {}) {
  const explicit = environment.DLS_COREPACK_CLI;
  if (explicit !== undefined && explicit.length > 0) {
    const candidate = resolve(explicit);
    if (!fileExists(candidate)) throw new Error(`Configured Corepack CLI does not exist: ${candidate}`);
    return candidate;
  }

  const pathValue = environment.PATH ?? environment.Path ?? environment.path ?? "";
  const candidates = [
    join(dirname(execPath), "node_modules", "corepack", "dist", "corepack.js"),
    join(
      dirname(dirname(execPath)),
      "lib",
      "node_modules",
      "corepack",
      "dist",
      "corepack.js",
    ),
    ...pathValue
      .split(delimiter)
      .filter((entry) => entry.length > 0)
      .map((entry) => join(entry, "node_modules", "corepack", "dist", "corepack.js")),
  ];
  const corepackCli = candidates.find((candidate) => fileExists(candidate));
  if (corepackCli === undefined) {
    throw new Error("Corepack CLI is unavailable beside Node and in PATH installation roots");
  }
  return resolve(corepackCli);
}
