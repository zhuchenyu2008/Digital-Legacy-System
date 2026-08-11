import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveCorepackCli } from "./toolchain-runtime.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const forwardedArguments = process.argv.slice(2).filter((argument) => argument !== "--describe");
const candidates =
  process.platform === "win32"
    ? ["pwsh.exe", "powershell.exe"].map((executable) => [
        executable,
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        "ops/scripts/acceptance.ps1",
        ...forwardedArguments,
      ])
    : [["bash", "ops/scripts/acceptance.sh", ...forwardedArguments]];

if (process.argv.includes("--describe")) {
  process.stdout.write(`${JSON.stringify({ command: candidates[0] })}\n`);
  process.exit(0);
}

function acceptanceEnvironment() {
  const environment = { ...process.env };
  environment.DLS_NODE_EXECUTABLE = process.execPath;
  environment.DLS_COREPACK_CLI = resolveCorepackCli();
  if (process.platform !== "win32") return environment;

  const shimDirectory = resolve(root, ".acceptance-artifacts", "runtime-shims");
  mkdirSync(shimDirectory, { recursive: true });
  writeFileSync(
    resolve(shimDirectory, "node.cmd"),
    `@echo off\r\n"${process.execPath}" %*\r\n`,
    "utf8",
  );
  writeFileSync(
    resolve(shimDirectory, "corepack.cmd"),
    `@echo off\r\n"${process.execPath}" "${environment.DLS_COREPACK_CLI}" %*\r\n`,
    "utf8",
  );
  writeFileSync(
    resolve(shimDirectory, "pnpm.cmd"),
    `@echo off\r\n"${process.execPath}" "${environment.DLS_COREPACK_CLI}" pnpm %*\r\n`,
    "utf8",
  );
  const pathKey = Object.keys(environment).find((key) => key.toLowerCase() === "path") ?? "Path";
  environment[pathKey] = `${shimDirectory};${environment[pathKey] ?? ""}`;
  return environment;
}

const environment = acceptanceEnvironment();

for (const [executable, ...arguments_] of candidates) {
  const result = spawnSync(executable, arguments_, {
    cwd: root,
    env: environment,
    stdio: "inherit",
  });
  if ((result.error)?.code === "ENOENT") continue;
  if (result.error !== undefined) throw result.error;
  process.exit(result.status ?? 1);
}

throw new Error("No supported PowerShell executable is available for the Windows acceptance gate");
