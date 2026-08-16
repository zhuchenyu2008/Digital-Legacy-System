import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const targets = ["api", "worker", "web", "caddy"];
const args = process.argv.slice(2);

function option(name, required = true) {
  const index = args.indexOf(name);
  const value = index < 0 ? undefined : args[index + 1];
  if (required && (value === undefined || value.startsWith("--"))) {
    throw new Error(`${name} is required`);
  }
  return value;
}

const registry = option("--registry");
const tag = option("--tag");
const output = resolve(option("--output"));
const push = args.includes("--push");
if (!/^[A-Za-z0-9._/-]+$/u.test(registry) || !/^[A-Za-z0-9._-]+$/u.test(tag)) {
  throw new Error("registry and tag contain unsafe characters");
}
if (!push && !args.includes("--load")) throw new Error("choose --push or --load");

const temporary = await mkdtemp(join(tmpdir(), "dls-release-images-"));
try {
  const imageDigests = {};
  for (const target of targets) {
    const metadata = join(temporary, `${target}.json`);
    const command = [
      "buildx",
      "build",
      "--target",
      target,
      "--tag",
      `${registry}/dls-${target}:${tag}`,
      "--metadata-file",
      metadata,
      push ? "--push" : "--load",
      ".",
    ];
    await run("docker", command, { cwd: process.cwd(), maxBuffer: 16 * 1024 * 1024 });
    const metadataValue = JSON.parse(await readFile(metadata, "utf8"));
    const digest = metadataValue["containerimage.digest"];
    if (typeof digest !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(digest)) {
      throw new Error(`build did not produce an immutable digest for ${target}`);
    }
    imageDigests[target] = digest;
  }
  const manifest = {
    version: tag,
    createdAt: new Date().toISOString(),
    registry,
    imageDigests,
    source: "ci-build-once",
  };
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ output, imageDigests })}\n`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
