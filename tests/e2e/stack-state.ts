import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const workspaceRoot = resolve(import.meta.dirname, "../..");

export type E2EStackState = Readonly<{
  projectName: string;
  runtimeDirectory: string;
  composeFiles: readonly string[];
  baseUrl: string;
  mailpitUrl: string;
  mailTransport: string;
  services: readonly string[];
  formalRows: number;
  simulationRows: number;
}>;

export function e2eStateFile(environment: NodeJS.ProcessEnv = process.env): string {
  const value = environment.DLS_E2E_STATE_FILE;
  if (value === undefined || value.length === 0) {
    throw new Error("DLS_E2E_STATE_FILE is required");
  }
  return value;
}

export function assertE2ERuntimeDirectory(projectName: string, value: string): string {
  if (!/^dls-e2e-[a-z0-9][a-z0-9-]{0,48}$/u.test(projectName)) {
    throw new Error("E2E runtime project name is outside the disposable namespace");
  }
  const expected = resolve(workspaceRoot, ".e2e-runtime", projectName);
  const actual = resolve(value);
  const comparable = (path: string) => (process.platform === "win32" ? path.toLowerCase() : path);
  if (comparable(actual) !== comparable(expected)) {
    throw new Error("E2E runtime directory is outside its disposable project directory");
  }
  return actual;
}

export function contactStateFile(
  index: number,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new Error("contact storage-state index must be a non-negative integer");
  }
  const directory = environment.DLS_E2E_CONTACT_STATE_DIR;
  if (directory === undefined || directory.length === 0) {
    throw new Error("DLS_E2E_CONTACT_STATE_DIR is required");
  }
  return resolve(directory, `contact-${index + 1}.json`).replaceAll("\\", "/");
}

export async function readE2EState(): Promise<E2EStackState> {
  return JSON.parse(await readFile(e2eStateFile(), "utf8")) as E2EStackState;
}
