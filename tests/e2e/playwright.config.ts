import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { composeProjectName } from "./fixtures/app.js";

const runId = process.env.DLS_E2E_RUN_ID ?? `${process.pid}`;
const projectName = process.env.DLS_E2E_PROJECT_NAME ?? composeProjectName(runId);
const runtimeDirectory = resolve(".e2e-runtime", projectName);
const httpPort = process.env.DLS_E2E_HTTP_PORT ?? "18081";
const mailpitPort = process.env.DLS_E2E_MAILPIT_PORT ?? "18025";
const baseURL = process.env.DLS_E2E_BASE_URL ?? `http://127.0.0.1:${httpPort}`;

Object.assign(process.env, {
  DLS_E2E_PROJECT_NAME: projectName,
  DLS_E2E_RUNTIME_DIR: runtimeDirectory,
  DLS_E2E_STATE_FILE: resolve(runtimeDirectory, "state.json"),
  DLS_E2E_BASE_URL: baseURL,
  DLS_E2E_MAILPIT_URL: `http://127.0.0.1:${mailpitPort}`,
  DLS_E2E_HTTP_PORT: httpPort,
  DLS_E2E_MAILPIT_PORT: mailpitPort,
  DLS_HTTP_PORT: httpPort,
});

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  globalSetup: resolve(import.meta.dirname, "global-setup.ts"),
  globalTeardown: resolve(import.meta.dirname, "global-teardown.ts"),
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
