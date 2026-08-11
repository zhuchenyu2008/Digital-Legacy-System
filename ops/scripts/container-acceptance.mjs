import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { arch, platform } from "node:os";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const evidencePath = "docs/acceptance/linux-container-evidence.json";
const staticDeploymentTests = [
  "tests/deployment/acceptance-script.test.ts",
  "tests/deployment/backup-restore.test.ts",
  "tests/deployment/container-acceptance.test.ts",
  "tests/deployment/cross-platform-scripts.test.ts",
  "tests/deployment/production-compose.test.ts",
  "tests/deployment/release-tooling.test.ts",
  "tests/deployment/secret-generation.test.ts",
  "tests/deployment/vulnerability-allowlist.test.ts",
];
const gates = [
  { name: "versions", command: ["node", "ops/scripts/release-metadata.mjs", "--verify"] },
  {
    name: "format",
    command: [
      "bash",
      "-c",
      "corepack pnpm check && node node_modules/typescript/bin/tsc -b",
    ],
  },
  { name: "unit", command: ["corepack", "pnpm", "test:unit"] },
  { name: "crypto", command: ["corepack", "pnpm", "test:crypto"] },
  { name: "storage-filesystem", command: ["corepack", "pnpm", "test:storage:filesystem"] },
  { name: "email", command: ["corepack", "pnpm", "test:email"] },
  { name: "build", command: ["node", "ops/scripts/verify-build-artifacts.mjs"] },
  { name: "openapi", command: ["corepack", "pnpm", "openapi:check"] },
  {
    name: "security-core",
    command: [
      "bash",
      "-c",
      "corepack pnpm test:security && bash ops/scripts/security-scan.sh --skip-external",
    ],
  },
  {
    name: "deployment",
    command: [
      "node",
      "node_modules/vitest/vitest.mjs",
      "run",
      "--config",
      "vitest.workspace.ts",
      "--project",
      "deployment",
      ...staticDeploymentTests,
    ],
  },
  {
    name: "stack-smoke",
    command: [
      "node",
      "--input-type=module",
      "--eval",
      "const base=process.env.ACCEPTANCE_BASE_URL;if(!base)throw new Error('ACCEPTANCE_BASE_URL is required');const response=await fetch(new URL('/health/ready',base));if(!response.ok)throw new Error(`stack readiness failed: ${response.status}`);",
    ],
  },
  {
    name: "evidence-parity",
    command: [
      "node",
      "ops/scripts/verify-evidence-parity.mjs",
      "--host",
      "docs/acceptance/local-v1-evidence.md",
    ],
  },
];

const manifest = { evidencePath, gates };
if (process.argv.includes("--describe")) {
  process.stdout.write(`${JSON.stringify(manifest)}\n`);
  process.exit(0);
}

function run(command, logPath) {
  return new Promise((resolveRun) => {
    const [executable, ...args] = command;
    const child = spawn(executable, args, {
      cwd: root,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks = [];
    child.stdout.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    child.once("error", async (error) => {
      chunks.push(Buffer.from(`${String(error)}\n`));
      await writeFile(logPath, Buffer.concat(chunks));
      resolveRun(1);
    });
    child.once("exit", async (code) => {
      await writeFile(logPath, Buffer.concat(chunks));
      resolveRun(code ?? 1);
    });
  });
}

const outputArgument = process.argv.indexOf("--output");
const output = resolve(
  root,
  outputArgument >= 0 ? (process.argv[outputArgument + 1] ?? evidencePath) : evidencePath,
);
const logDirectory = "/tmp/dls-container-acceptance";
await mkdir(logDirectory, { recursive: true });
const startedAt = new Date().toISOString();
const results = [];
let blocked = false;
for (const gate of gates) {
  const gateStartedAt = new Date().toISOString();
  const started = Date.now();
  const logPath = `${logDirectory}/${gate.name}.log`;
  if (blocked) {
    await writeFile(logPath, "Skipped because an earlier required gate failed.\n", "utf8");
    results.push({
      name: gate.name,
      command: gate.command,
      status: "skipped",
      exitCode: null,
      durationMs: 0,
      startedAt: gateStartedAt,
      endedAt: gateStartedAt,
    });
    continue;
  }
  const exitCode = await run(gate.command, logPath);
  const status = exitCode === 0 ? "passed" : "failed";
  results.push({
    name: gate.name,
    command: gate.command,
    status,
    exitCode,
    durationMs: Date.now() - started,
    startedAt: gateStartedAt,
    endedAt: new Date().toISOString(),
  });
  if (exitCode !== 0) blocked = true;
}

let releaseMetadata = null;
try {
  releaseMetadata = JSON.parse(await readFile(`${logDirectory}/versions.log`, "utf8"));
} catch {
  // The failed versions gate remains authoritative in the evidence.
}
const evidence = {
  schemaVersion: 1,
  kind: "linux-container-parity",
  timezone: "Asia/Shanghai",
  startedAt,
  endedAt: new Date().toISOString(),
  system: { os: platform(), architecture: arch() },
  releaseMetadata,
  gates: results,
};
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ evidence: output, passed: !blocked })}\n`);
if (blocked) process.exitCode = 1;
