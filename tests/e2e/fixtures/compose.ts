import { spawn } from "node:child_process";
import type { E2EStackState } from "../stack-state.js";
import { assertDisposableComposeProjectName } from "./app.js";

type CommandResult = Readonly<{ code: number | null; stdout: string; stderr: string }>;

function environment(state: E2EStackState): NodeJS.ProcessEnv {
  return {
    ...process.env,
    DLS_SECRETS_DIR: `${state.runtimeDirectory}/secrets`,
    DOCKER_CONFIG: `${state.runtimeDirectory}/docker-config`,
  };
}

function composeArguments(state: E2EStackState, args: readonly string[]): string[] {
  assertDisposableComposeProjectName(state.projectName);
  return [
    "compose",
    ...state.composeFiles.flatMap((file) => ["--file", file]),
    "--project-name",
    state.projectName,
    ...args,
  ];
}

function command(
  executable: string,
  args: readonly string[],
  state: E2EStackState,
): Promise<CommandResult> {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(executable, [...args], {
      env: environment(state),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    const timer = setTimeout(() => child.kill(), 180_000);
    child.once("error", (error) => {
      clearTimeout(timer);
      rejectCommand(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolveCommand({
        code,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}

export async function runCompose(
  state: E2EStackState,
  args: readonly string[],
): Promise<CommandResult> {
  const result = await command("docker", composeArguments(state, args), state);
  if (result.code !== 0) {
    throw new Error(`docker compose ${args.join(" ")} failed\n${result.stderr}`);
  }
  return result;
}

async function waitForReady(baseUrl: string): Promise<void> {
  const deadline = Date.now() + 180_000;
  do {
    try {
      const response = await fetch(new URL("/health/ready", baseUrl), {
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) return;
    } catch {
      // The API or PostgreSQL connection is still converging after restart.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  } while (Date.now() < deadline);
  throw new Error("E2E API did not recover after the service restart");
}

export async function restartStatefulServices(state: E2EStackState): Promise<void> {
  await runCompose(state, ["restart", "postgres", "api", "worker"]);
  await waitForReady(state.baseUrl);
  const running = await runCompose(state, ["ps", "--services", "--status", "running"]);
  for (const service of ["postgres", "api", "worker"]) {
    if (!running.stdout.split(/\r?\n/gu).includes(service)) {
      throw new Error(`${service} did not return to the running state`);
    }
  }
}

export async function queryPostgres(state: E2EStackState, sql: string): Promise<readonly string[]> {
  if (sql.length === 0 || /[\r\n]/u.test(sql))
    throw new Error("E2E SQL must be one non-empty line");
  const result = await runCompose(state, [
    "exec",
    "--no-TTY",
    "postgres",
    "psql",
    "--username",
    "postgres",
    "--dbname",
    "dls",
    "--tuples-only",
    "--no-align",
    "--set",
    "ON_ERROR_STOP=1",
    "--command",
    sql,
  ]);
  return result.stdout
    .split(/\r?\n/gu)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export async function workerObjectExists(
  state: E2EStackState,
  namespace: "private" | "staging",
  objectKey: string,
): Promise<boolean> {
  if (!/^[a-zA-Z0-9/_-]+$/u.test(objectKey)) throw new Error("object key is unsafe for inspection");
  const path = `/var/lib/dls/objects/${namespace}/${objectKey}`;
  const result = await command(
    "docker",
    composeArguments(state, ["exec", "--no-TTY", "worker", "test", "-f", path]),
    state,
  );
  if (result.code === 0) return true;
  if (result.code === 1) return false;
  throw new Error(`object inspection failed\n${result.stderr}`);
}
