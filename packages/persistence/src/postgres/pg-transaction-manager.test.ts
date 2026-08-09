import { describe, expect, it } from "vitest";
import { PgTransactionManager } from "./pg-transaction-manager.js";

function manager() {
  const client = {
    query: async () => ({ rows: [] }),
    release: () => undefined,
  };
  return new PgTransactionManager({ connect: async () => client as never });
}

describe("PostgreSQL transaction error mapping", () => {
  it("preserves application errors whose code is not a SQLSTATE", async () => {
    const error = Object.assign(new Error("release is locked"), {
      code: "DLS-RELEASE-LOCKED",
    });
    await expect(manager().run(async () => Promise.reject(error))).rejects.toBe(error);
  });

  it("maps genuine five-character SQLSTATE errors", async () => {
    const error = Object.assign(new Error("unique violation"), { code: "23505" });
    await expect(manager().run(async () => Promise.reject(error))).rejects.toMatchObject({
      name: "PersistenceError",
      code: "UNIQUE_VIOLATION",
    });
  });
});
