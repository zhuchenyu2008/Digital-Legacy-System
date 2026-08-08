import { afterAll, describe, expect, it } from "vitest";

import { createPgPool, PgTransactionManager } from "../../packages/persistence/src/postgres/index.js";
import { verifyPrivateAuditTable } from "../../packages/persistence/src/audit/audit-verifier.js";

const pool = createPgPool({
  connectionString:
    process.env.DATABASE_URL ?? "postgresql://postgres:test@127.0.0.1:55432/dls",
});
const manager = new PgTransactionManager(pool);

describe("private audit persistence", () => {
  it("appends a database-time ordered chain and verifies it", async () => {
    await pool.query("TRUNCATE audit.private_events RESTART IDENTITY");
    await manager.run((tx) =>
      tx.audit.append({
        eventId: "00000000-0000-0000-0000-000000000011",
        occurredAt: "2026-08-08T08:00:00Z",
        eventType: "TEST_ONE",
        actorType: "SYSTEM",
        actorIdDigest: Uint8Array.from({ length: 32 }, () => 1),
        aggregateType: "test",
        aggregateId: "00000000-0000-0000-0000-000000000011",
        payload: { ordinal: 1 },
        result: "SUCCESS",
      }),
    );
    await manager.run((tx) =>
      tx.audit.append({
        eventId: "00000000-0000-0000-0000-000000000012",
        occurredAt: "2026-08-08T08:00:01Z",
        eventType: "TEST_TWO",
        actorType: "SYSTEM",
        actorIdDigest: Uint8Array.from({ length: 32 }, () => 2),
        aggregateType: "test",
        aggregateId: "00000000-0000-0000-0000-000000000012",
        payload: { ordinal: 2 },
        result: "SUCCESS",
      }),
    );

    const client = await pool.connect();
    try {
      await expect(verifyPrivateAuditTable(client)).resolves.toEqual({ valid: true, entries: 2 });
    } finally {
      client.release();
    }
  });
});

afterAll(async () => {
  await pool.end();
});
