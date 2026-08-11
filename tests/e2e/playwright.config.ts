import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { assertDisposableComposeProjectName, composeProjectName } from "./fixtures/app.js";

const runId = process.env.DLS_E2E_RUN_ID ?? `${process.pid}`;
const projectName = assertDisposableComposeProjectName(
  process.env.DLS_E2E_PROJECT_NAME ?? composeProjectName(runId),
);
const runtimeDirectory = resolve(".e2e-runtime", projectName);
const ownerStateFile = resolve(runtimeDirectory, "owner-state.json");
const contactStateDirectory = resolve(runtimeDirectory, "contact-states");
const httpPort = process.env.DLS_E2E_HTTP_PORT ?? "18081";
const mailpitPort = process.env.DLS_E2E_MAILPIT_PORT ?? "18025";
const baseURL = process.env.DLS_E2E_BASE_URL ?? `http://localhost:${httpPort}`;

Object.assign(process.env, {
  DLS_E2E_PROJECT_NAME: projectName,
  DLS_E2E_RUNTIME_DIR: runtimeDirectory,
  DLS_E2E_STATE_FILE: resolve(runtimeDirectory, "state.json"),
  DLS_E2E_OWNER_STATE_FILE: ownerStateFile,
  DLS_E2E_CONTACT_STATE_DIR: contactStateDirectory,
  DLS_E2E_BASE_URL: baseURL,
  DLS_E2E_MAILPIT_URL: `http://127.0.0.1:${mailpitPort}`,
  DLS_E2E_HTTP_PORT: httpPort,
  DLS_E2E_MAILPIT_PORT: mailpitPort,
  DLS_HTTP_PORT: httpPort,
});

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  timeout: 180_000,
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
  projects: [
    {
      name: "readiness",
      testMatch: "fixtures/stack-readiness.spec.ts",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "bootstrap",
      dependencies: ["readiness"],
      testMatch: "01-bootstrap-arm.spec.ts",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "journeys",
      dependencies: ["bootstrap"],
      testMatch: /0[2-8]-.*\.spec\.ts/u,
      use: { ...devices["Desktop Chrome"], storageState: ownerStateFile },
    },
    {
      name: "mobile-chromium",
      dependencies: ["journeys"],
      testMatch: "09-browser-smoke.spec.ts",
      use: { ...devices["Pixel 7"], storageState: ownerStateFile },
    },
    {
      name: "firefox-smoke",
      dependencies: ["journeys"],
      testMatch: "09-browser-smoke.spec.ts",
      use: { ...devices["Desktop Firefox"], storageState: ownerStateFile },
    },
    {
      name: "webkit-smoke",
      dependencies: ["journeys"],
      testMatch: "09-browser-smoke.spec.ts",
      use: { ...devices["Desktop Safari"], storageState: ownerStateFile },
    },
  ],
});
