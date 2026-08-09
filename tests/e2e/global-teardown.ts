import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import type { FullConfig } from "@playwright/test";
import { readE2EState } from "./stack-state.js";

async function run(executable: string, args: readonly string[], environment: NodeJS.ProcessEnv) {
  await new Promise<void>((resolveRun, rejectRun) => {
    const child = spawn(executable, [...args], {
      env: environment,
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", rejectRun);
    child.once("exit", (code) => {
      if (code === 0) resolveRun();
      else rejectRun(new Error(`${executable} exited with ${code ?? "signal"}`));
    });
  });
}

export default async function globalTeardown(_config: FullConfig): Promise<void> {
  const state = await readE2EState().catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  });
  if (state === undefined) return;
  const secretDirectory = `${state.runtimeDirectory}/secrets`;
  const dockerConfigDirectory = `${state.runtimeDirectory}/docker-config`;
  const composeArguments = state.composeFiles.flatMap((file) => ["--file", file]);
  await run(
    "docker",
    [
      "compose",
      ...composeArguments,
      "--project-name",
      state.projectName,
      "down",
      "--remove-orphans",
      "--volumes",
    ],
    {
      ...process.env,
      DLS_SECRETS_DIR: secretDirectory,
      DOCKER_CONFIG: dockerConfigDirectory,
    },
  );
  await rm(state.runtimeDirectory, { recursive: true, force: true });
}
