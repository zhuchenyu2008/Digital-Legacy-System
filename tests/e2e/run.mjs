import { spawn, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { snapshotGeneratedFile } from "./support/generated-file-snapshot.mjs";

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const children = [];
let stopping = false;

function start(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: workspace,
    stdio: "inherit",
    ...options,
  });
  children.push(child);
  return child;
}

function stop(child) {
  if (child.pid === undefined || child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    child.kill("SIGTERM");
  }
}

function cleanup() {
  if (stopping) return;
  stopping = true;
  for (const child of [...children].reverse()) stop(child);
}

async function waitFor(url, child, attempts = 240) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`测试服务提前退出：${url}`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {
      // The service is still starting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error(`等待测试服务超时：${url}`);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    cleanup();
    process.exit(130);
  });
}

let finalExitCode = 1;
const nextEnvironment = await snapshotGeneratedFile(resolve(workspace, "apps/web/next-env.d.ts"));
try {
  const productionMode = process.argv.includes("--production");
  const requested = process.argv.slice(2).filter((argument) => argument !== "--production");
  const api = start(process.execPath, ["tests/e2e/support/contact-api-stub.mjs"]);
  await waitFor("http://127.0.0.1:4311/health", api);
  if (productionMode) {
    const build = start(
      process.execPath,
      [resolve(workspace, "apps/web/node_modules/next/dist/bin/next"), "build"],
      {
        cwd: resolve(workspace, "apps/web"),
        env: { ...process.env, DLS_API_INTERNAL_URL: "http://127.0.0.1:4311" },
      },
    );
    const buildExitCode = await new Promise((resolveExit) => {
      build.once("exit", (code) => resolveExit(code ?? 1));
    });
    if (buildExitCode !== 0) throw new Error(`Next.js production build failed (${buildExitCode})`);
  }
  const web = start(
    process.execPath,
    [
      resolve(workspace, "apps/web/node_modules/next/dist/bin/next"),
      productionMode ? "start" : "dev",
      "--hostname",
      "127.0.0.1",
      "--port",
      "4173",
    ],
    {
      cwd: resolve(workspace, "apps/web"),
      env: { ...process.env, DLS_API_INTERNAL_URL: "http://127.0.0.1:4311" },
    },
  );
  await waitFor("http://127.0.0.1:4173/contact/workflows/current", web);
  const playwright = start(process.execPath, [
    "node_modules/@playwright/test/cli.js",
    "test",
    ...(requested.length > 0
      ? requested
      : ["tests/e2e/contact-workflow.spec.ts", "tests/e2e/scenario-isolation.spec.ts"]),
    "--pass-with-no-tests",
  ]);
  finalExitCode = await new Promise((resolveExit) => {
    playwright.once("exit", (code) => resolveExit(code ?? 1));
  });
} finally {
  cleanup();
  await nextEnvironment.restore();
}
process.exit(finalExitCode);
