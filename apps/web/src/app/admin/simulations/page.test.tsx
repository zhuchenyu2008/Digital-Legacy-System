import { afterEach, describe, expect, it, vi } from "vitest";
import { SimulationConsole } from "../../../features/simulation/simulation-console";
import SimulationsPage from "./page";

afterEach(() => vi.unstubAllEnvs());

describe("simulation page runtime boundary", () => {
  it("returns a not-found boundary when test mode is disabled", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("DLS_TEST_MODE", "false");

    expect(() => SimulationsPage()).toThrow(/NEXT_HTTP_ERROR_FALLBACK;404/u);
  });

  it("renders the console only in explicit test mode", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("DLS_TEST_MODE", "true");

    expect(SimulationsPage().type).toBe(SimulationConsole);
  });
});
