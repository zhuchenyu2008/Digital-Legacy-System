import { describe, expect, it } from "vitest";
import { nextRuntime } from "./next-runtime";

describe("Next runtime test-mode boundary", () => {
  it("enables test-only pages only with an explicit non-production flag", () => {
    expect(nextRuntime({ NODE_ENV: "test", DLS_TEST_MODE: "true" })).toMatchObject({
      development: true,
      testMode: true,
    });
    expect(nextRuntime({ NODE_ENV: "test" }).testMode).toBe(false);
  });

  it("rejects test mode in a production web process", () => {
    expect(() => nextRuntime({ NODE_ENV: "production", DLS_TEST_MODE: "true" })).toThrow(
      /DLS_TEST_MODE.*production/u,
    );
  });
});
