import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { FullConfig } from "@playwright/test";
import { assertDisposableComposeProjectName, validateMailpitTransport } from "./fixtures/app.js";
import { assertE2ERuntimeDirectory, type E2EStackState, e2eStateFile } from "./stack-state.js";

type CommandResult = Readonly<{ stdout: string; stderr: string }>;

const workspace = resolve(import.meta.dirname, "../..");
const composeFiles = [
  resolve(workspace, "compose.yaml"),
  resolve(import.meta.dirname, "compose.e2e.yaml"),
];

async function command(
  executable: string,
  args: readonly string[],
  options: Readonly<{ environment: NodeJS.ProcessEnv; input?: string; timeoutMs?: number }>,
): Promise<CommandResult> {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(executable, [...args], {
      cwd: workspace,
      env: options.environment,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    const timer = setTimeout(() => child.kill(), options.timeoutMs ?? 600_000);
    child.once("error", (error) => {
      clearTimeout(timer);
      rejectCommand(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      const result = {
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      };
      if (code === 0) resolveCommand(result);
      else
        rejectCommand(
          new Error(
            `${executable} ${args.join(" ")} failed with ${code ?? "signal"}\n${result.stderr}`,
          ),
        );
    });
    if (options.input === undefined) child.stdin.end();
    else child.stdin.end(options.input);
  });
}

function composeArgs(projectName: string, args: readonly string[]): string[] {
  return [
    "compose",
    "--file",
    composeFiles[0] ?? "compose.yaml",
    "--file",
    composeFiles[1] ?? "tests/e2e/compose.e2e.yaml",
    "--project-name",
    projectName,
    ...args,
  ];
}

async function compose(
  projectName: string,
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
  input?: string,
): Promise<CommandResult> {
  return command("docker", composeArgs(projectName, args), {
    environment,
    ...(input === undefined ? {} : { input }),
  });
}

async function waitFor(url: string, timeoutMs = 180_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  do {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
    } catch {
      // Container health checks are still converging.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_000));
  } while (Date.now() < deadline);
  throw new Error(`timed out waiting for ${url}`);
}

async function scalar(
  projectName: string,
  database: string,
  sql: string,
  environment: NodeJS.ProcessEnv,
): Promise<number> {
  const result = await compose(
    projectName,
    [
      "exec",
      "--no-TTY",
      "postgres",
      "psql",
      "--username",
      "postgres",
      "--dbname",
      database,
      "--tuples-only",
      "--no-align",
      "--set",
      "ON_ERROR_STOP=1",
      "--command",
      sql,
    ],
    environment,
  );
  const value = Number(result.stdout.trim());
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`invalid SQL scalar: ${result.stdout}`);
  return value;
}

export default async function globalSetup(_config: FullConfig): Promise<void> {
  const projectName = process.env.DLS_E2E_PROJECT_NAME;
  const runtimeDirectory = process.env.DLS_E2E_RUNTIME_DIR;
  const baseUrl = process.env.DLS_E2E_BASE_URL;
  const mailpitUrl = process.env.DLS_E2E_MAILPIT_URL;
  if (
    projectName === undefined ||
    runtimeDirectory === undefined ||
    baseUrl === undefined ||
    mailpitUrl === undefined
  ) {
    throw new Error("Playwright E2E runtime environment was not initialized by its config");
  }
  assertDisposableComposeProjectName(projectName);
  assertE2ERuntimeDirectory(projectName, runtimeDirectory);
  const secretDirectory = resolve(runtimeDirectory, "secrets");
  const dockerConfigDirectory = resolve(runtimeDirectory, "docker-config");
  await mkdir(secretDirectory, { recursive: true });
  await mkdir(dockerConfigDirectory, { recursive: true });
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    DLS_SECRETS_DIR: secretDirectory,
    // Compose secrets are bind-mounted into non-root containers during E2E.
    DLS_SECRETS_FILE_MODE: "0444",
    DOCKER_CONFIG: dockerConfigDirectory,
  };
  validateMailpitTransport("smtp://mailpit:1025");
  let started = false;
  try {
    await command(process.execPath, ["ops/scripts/generate-development-secrets.mjs"], {
      environment,
    });
    const configured = await compose(projectName, ["config", "--format", "json"], environment);
    const document = JSON.parse(configured.stdout) as {
      services?: Record<string, { environment?: Record<string, string> }>;
    };
    const mailTransport = document.services?.api?.environment?.MAIL_TRANSPORT_URL;
    if (mailTransport === undefined) throw new Error("Compose API mail transport is missing");
    validateMailpitTransport(mailTransport);

    await compose(
      projectName,
      ["--profile", "ops", "build", "migrator", "api", "worker", "web", "caddy"],
      environment,
    );
    started = true;
    await compose(projectName, ["up", "--detach", "postgres", "mailpit"], environment);
    await compose(
      projectName,
      [
        "--profile",
        "ops",
        "run",
        "--rm",
        "--entrypoint",
        "/bin/sh",
        "migrator",
        "-ec",
        'export PGBOSS_DATABASE_URL="postgresql://dls_migrator:$(cat /run/secrets/migrator_db_password)@postgres:5432/dls"; exec node apps/worker/node_modules/pg-boss/dist/cli.js migrate',
      ],
      environment,
    );
    await compose(projectName, ["--profile", "ops", "run", "--rm", "migrator"], environment);
    await compose(
      projectName,
      [
        "exec",
        "--no-TTY",
        "postgres",
        "psql",
        "--username",
        "postgres",
        "--dbname",
        "postgres",
        "--set",
        "ON_ERROR_STOP=1",
        "--command",
        "CREATE DATABASE dls_simulation OWNER dls_api",
      ],
      environment,
    );
    const simulationMigration = await readFile(
      resolve(workspace, "packages/persistence/migrations-test/001_simulation_schema.up.sql"),
      "utf8",
    );
    await compose(
      projectName,
      [
        "exec",
        "--no-TTY",
        "postgres",
        "psql",
        "--username",
        "postgres",
        "--dbname",
        "dls_simulation",
        "--set",
        "ON_ERROR_STOP=1",
      ],
      environment,
      `SET ROLE dls_api;\n${simulationMigration}`,
    );
    await compose(projectName, ["up", "--detach", "api", "worker", "web", "caddy"], environment);
    await Promise.all([
      waitFor(new URL("/health/ready", baseUrl).href),
      waitFor(new URL("/readyz", mailpitUrl).href),
    ]);

    const running = await compose(
      projectName,
      ["ps", "--services", "--status", "running"],
      environment,
    );
    const services = running.stdout
      .split(/\r?\n/gu)
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
      .filter((value) => ["api", "caddy", "mailpit", "postgres", "web", "worker"].includes(value))
      .sort();
    const expectedServices = ["api", "caddy", "mailpit", "postgres", "web", "worker"];
    if (JSON.stringify(services) !== JSON.stringify(expectedServices)) {
      throw new Error(`E2E services are not all running: ${services.join(", ")}`);
    }
    const formalRows = await scalar(
      projectName,
      "dls",
      `SELECT (
        (SELECT count(*) FROM app.owner_profile) +
        (SELECT count(*) FROM app.emergency_contacts) +
        (SELECT count(*) FROM app.legacy_packages) +
        (SELECT count(*) FROM app.workflows)
      )::int`,
      environment,
    );
    const simulationRows = await scalar(
      projectName,
      "dls_simulation",
      "SELECT count(*)::int FROM simulation.scenarios",
      environment,
    );
    const state: E2EStackState = Object.freeze({
      projectName,
      runtimeDirectory,
      composeFiles,
      baseUrl,
      mailpitUrl,
      mailTransport,
      services,
      formalRows,
      simulationRows,
    });
    await writeFile(e2eStateFile(), `${JSON.stringify(state, null, 2)}\n`, "utf8");
  } catch (error) {
    if (started) {
      const logs = await compose(
        projectName,
        ["logs", "--no-color", "--tail", "200"],
        environment,
      ).catch(() => ({ stdout: "", stderr: "" }));
      process.stderr.write(logs.stdout.replace(/[A-Za-z0-9+/=_-]{32,}/gu, "[REDACTED]"));
      await compose(projectName, ["down", "--remove-orphans", "--volumes"], environment).catch(
        () => undefined,
      );
    }
    await rm(runtimeDirectory, { recursive: true, force: true });
    throw error;
  }
}
