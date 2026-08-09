import { readFile } from "node:fs/promises";

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

export async function readE2EState(): Promise<E2EStackState> {
  return JSON.parse(await readFile(e2eStateFile(), "utf8")) as E2EStackState;
}
