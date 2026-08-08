import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const packageDir = resolve(import.meta.dirname, "..");
const workspaceDir = resolve(packageDir, "../..");
const target = "wasm32-unknown-unknown";
const wasmInput = join(workspaceDir, "target", target, "release", "dls_vss.wasm");

function run(command, args, cwd = workspaceDir) {
  const result = spawnSync(command, args, {
    cwd,
    env: {
      ...process.env,
      RUSTFLAGS: process.env.RUSTFLAGS ?? "-C link-arg=--strip-debug",
    },
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with ${result.status}`);
  }
}

const distDir = join(packageDir, "dist");
const browserDir = join(distDir, "browser");
const nodeDir = join(distDir, "node");
rmSync(browserDir, { recursive: true, force: true });
rmSync(nodeDir, { recursive: true, force: true });
mkdirSync(browserDir, { recursive: true });
mkdirSync(nodeDir, { recursive: true });

run("cargo", ["test", "--locked"]);
run("rustup", ["target", "add", target]);
run("cargo", ["build", "--release", "-p", "dls-vss", "--target", target, "--locked"]);
run("wasm-bindgen", [wasmInput, "--target", "web", "--out-dir", browserDir]);
run("wasm-bindgen", [wasmInput, "--target", "nodejs", "--out-dir", nodeDir]);

writeFileSync(join(nodeDir, "package.json"), '{\n  "type": "commonjs"\n}\n', "utf8");

function collectFiles(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
}

function hashes(directory) {
  return Object.fromEntries(
    collectFiles(directory).map((name) => {
      const digest = createHash("sha256").update(readFileSync(join(directory, name))).digest("hex");
      return [name, digest];
    }),
  );
}

writeFileSync(
  join(distDir, "SHA256SUMS.json"),
  `${JSON.stringify({ browser: hashes(browserDir), node: hashes(nodeDir) }, null, 2)}\n`,
  "utf8",
);

console.log(`Generated deterministic VSS bundles under ${dirname(browserDir)}`);
