import { describe, expect, it, vi } from "vitest";
import { reconcileDueDeadlines } from "./deadline-reconciliation.js";

describe("deadline reconciliation", () => {
  it("re-enqueues every durable due aggregate with versioned idempotency keys and a heartbeat", async () => {
    const queries: Array<{ sql: string; values?: readonly unknown[] }> = [];
    const rowCounts = [2, 1, 3, 1];
    const database = {
      query: vi.fn(async (sql: string, values?: readonly unknown[]) => {
        queries.push({ sql, ...(values === undefined ? {} : { values }) });
        return { rows: [], rowCount: rowCounts.shift() ?? 0 };
      }),
    };

    await expect(reconcileDueDeadlines(database as never)).resolves.toEqual({
      checkins: 2,
      releases: 1,
      recoveries: 3,
    });
    expect(queries).toHaveLength(4);
    expect(queries[0]?.values).toEqual(["CHECKIN_EVALUATE_REQUESTED"]);
    expect(queries[1]?.values).toEqual(["WORKFLOW_ADVANCE_REQUESTED"]);
    expect(queries[2]?.values).toEqual(["RECOVERY_EXPIRE_REQUESTED"]);
    for (const query of queries.slice(0, 3)) {
      expect(query.sql).toContain("ON CONFLICT (idempotency_key) DO NOTHING");
      expect(query.sql).toMatch(/aggregateVersion/u);
    }
    expect(queries[3]?.sql).toContain("'deadline-scanner'");
  });
});
