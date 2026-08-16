import { readFile } from "node:fs/promises";

const path = process.argv[2];
if (!path) throw new Error("image manifest path is required");
const value = JSON.parse(await readFile(path, "utf8"));
const digest = /^sha256:[0-9a-f]{64}$/u;
const registry = /^(?:[A-Za-z0-9.-]+)(?::[0-9]{1,5})?(?:\/[A-Za-z0-9._-]+)+$/u;
if (
  typeof value !== "object" ||
  value === null ||
  !/^[A-Za-z0-9._-]+$/u.test(String(value.version ?? "")) ||
  !registry.test(String(value.registry ?? "")) ||
  value.source !== "ci-build-once" ||
  typeof value.imageDigests !== "object" ||
  value.imageDigests === null ||
  ["api", "worker", "web", "caddy"].some((name) => !digest.test(value.imageDigests[name]))
) {
  throw new Error("image manifest is invalid or not produced by the CI build");
}
process.stdout.write(`${JSON.stringify(value)}\n`);
