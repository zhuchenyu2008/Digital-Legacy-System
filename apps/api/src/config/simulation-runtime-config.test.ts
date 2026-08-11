import { describe, expect, it } from "vitest";
import { applicationImports } from "../app.module.js";
import { SimulationModule } from "../simulation/simulation.module.js";
import { getApiRuntimeConfig } from "./api-runtime-config.js";
import { loadApiConfig } from "./load-config.js";
import { getSimulationRuntimeConfig } from "./simulation-runtime-config.js";

const enabledEnvironment = Object.freeze({
  NODE_ENV: "test",
  DLS_TEST_MODE: "true",
  DLS_SIMULATION_MODE: "enabled",
  DATABASE_URL: "postgresql://postgres:test@127.0.0.1:55432/dls",
  SIMULATION_DATABASE_URL: "postgresql://postgres:test@127.0.0.1:55432/dls_simulation",
  SIMULATION_STORAGE_ROOT: "D:/dls-test/simulations",
  MAIL_TRANSPORT_URL: "smtp://mailpit:1025",
  SIMULATION_MAIL_ALLOWLIST: "*@example.test",
});

describe("test-mode runtime gates", () => {
  it("requires the explicit test-mode flag before enabling simulation", () => {
    expect(() =>
      getSimulationRuntimeConfig({ ...enabledEnvironment, DLS_TEST_MODE: undefined }),
    ).toThrow(/DLS_TEST_MODE=true/u);
    expect(() =>
      getSimulationRuntimeConfig({ ...enabledEnvironment, DLS_TEST_MODE: "false" }),
    ).toThrow(/DLS_TEST_MODE=true/u);
    expect(getSimulationRuntimeConfig(enabledEnvironment)).toMatchObject({ enabled: true });
  });

  it("rejects the test-mode flag during production configuration and process boot", () => {
    const productionTestMode = { NODE_ENV: "production", DLS_TEST_MODE: "true" };

    expect(() => getApiRuntimeConfig(productionTestMode)).toThrow(/DLS_TEST_MODE.*production/u);
    expect(() => loadApiConfig(productionTestMode)).toThrow(/DLS_TEST_MODE.*production/u);
  });

  it("registers simulation routes only for a fully enabled test-mode process", () => {
    expect(applicationImports({})).not.toContain(SimulationModule);
    expect(applicationImports(enabledEnvironment)).toContain(SimulationModule);
  });
});
