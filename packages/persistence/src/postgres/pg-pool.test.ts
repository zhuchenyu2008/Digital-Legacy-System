import { describe, expect, test } from "vitest";
import { resolvePgPoolMax } from "./pg-pool.js";

describe("PostgreSQL pool limits", () => {
  test("uses the configured process pool budget", () => {
    expect(resolvePgPoolMax({ DATABASE_POOL_MAX: "4" })).toBe(4);
  });

  test("falls back for invalid values and caps excessive values", () => {
    expect(resolvePgPoolMax({ DATABASE_POOL_MAX: "0" }, 6)).toBe(6);
    expect(resolvePgPoolMax({ DATABASE_POOL_MAX: "999" })).toBe(100);
  });
});
