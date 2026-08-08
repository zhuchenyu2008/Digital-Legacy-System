import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createPgPool, PgTransactionManager } from "../../packages/persistence/src/postgres/index.js";

const connectionString =
  process.env.DATABASE_URL ?? "postgresql://postgres:test@127.0.0.1:55432/dls";

function ownerProfileInput() {
  return {
    singleton_id: true,
    display_name_ciphertext: Buffer.from("display-name"),
    display_name_nonce: Buffer.alloc(24, 1),
    display_name_key_version: 1,
    primary_email_ciphertext: Buffer.from("email"),
    primary_email_nonce: Buffer.alloc(24, 2),
    primary_email_key_version: 1,
    primary_email_lookup_hmac: Buffer.alloc(32, 3),
    setup_state: "INCOMPLETE",
  };
}

describe("transaction and repository contracts", () => {
  const pool = createPgPool({ connectionString });
  const manager = new PgTransactionManager(pool);

  beforeEach(async () => {
    await pool.query("DELETE FROM app.domain_outbox");
    await pool.query("DELETE FROM app.owner_credentials");
    await pool.query("DELETE FROM app.owner_profile");
  });

  afterAll(async () => {
    await pool.end();
  });

  it("rolls back an aggregate and outbox write together", async () => {
    await expect(
      manager.run(async (tx) => {
        await tx.repositories.ownerProfile.insert(ownerProfileInput());
        await tx.outbox.enqueue({
          eventType: "TEST_ROLLBACK",
          aggregateType: "test",
          aggregateId: "00000000-0000-0000-0000-000000000001",
          payload: { version: 1 },
          idempotencyKey: "test-rollback-1",
        });
        throw new Error("force rollback");
      }),
    ).rejects.toThrow("force rollback");

    const result = await pool.query(
      "SELECT count(*)::int AS count FROM app.domain_outbox WHERE idempotency_key = $1",
      ["test-rollback-1"],
    );
    expect(result.rows[0]?.count).toBe(0);
    const aggregate = await pool.query("SELECT count(*)::int AS count FROM app.owner_profile");
    expect(aggregate.rows[0]?.count).toBe(0);
  });

  it("rejects nested transaction scopes", async () => {
    await expect(manager.run(() => manager.run(async () => undefined))).rejects.toMatchObject({
      code: "NESTED_TRANSACTION",
    });
  });

  it("uses the expected version for updates and rejects stale writers", async () => {
    await manager.run((tx) => tx.repositories.ownerProfile.insert(ownerProfileInput()));

    const updated = await manager.run((tx) =>
      tx.repositories.ownerProfile.updateVersioned(true, 0, { setup_state: "READY" }),
    );
    expect(updated.version).toBe(1);
    expect(updated.setup_state).toBe("READY");

    const locked = await manager.run((tx) =>
      tx.repositories.ownerProfile.findById(true, { forUpdate: true }),
    );
    expect(locked?.primary_email_key_version).toBe(1);

    await expect(
      manager.run((tx) =>
        tx.repositories.ownerProfile.updateVersioned(true, 0, { setup_state: "ARMED" }),
      ),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  });

  it("maps database uniqueness failures to a stable error code", async () => {
    await manager.run((tx) => tx.repositories.ownerProfile.insert(ownerProfileInput()));
    await expect(
      manager.run((tx) => tx.repositories.ownerProfile.insert(ownerProfileInput())),
    ).rejects.toMatchObject({ code: "UNIQUE_VIOLATION" });
  });

  it("deduplicates committed outbox events by idempotency key", async () => {
    const event = {
      eventType: "TEST_COMMIT",
      aggregateType: "test",
      aggregateId: "00000000-0000-0000-0000-000000000002",
      payload: { version: 1 },
      idempotencyKey: "test-commit-1",
    };
    const first = await manager.run((tx) => tx.outbox.enqueue(event));
    const second = await manager.run((tx) => tx.outbox.enqueue(event));
    expect(second.id).toBe(first.id);

    const result = await pool.query(
      "SELECT count(*)::int AS count FROM app.domain_outbox WHERE idempotency_key = $1",
      [event.idempotencyKey],
    );
    expect(result.rows[0]?.count).toBe(1);
  });

  it("stores one response per actor-scoped idempotency key and rejects request reuse", async () => {
    const key = {
      actorScope: "owner:true",
      commandName: "test.command",
      keyDigest: Uint8Array.from({ length: 32 }, () => 4),
      requestHash: Uint8Array.from({ length: 32 }, () => 5),
    };
    const first = await manager.run(async (tx) => {
      const record = await tx.repositories.idempotency.reserve(key);
      return tx.repositories.idempotency.complete(record.id, 201, { accepted: true });
    });
    const replay = await manager.run((tx) => tx.repositories.idempotency.reserve(key));
    expect(replay.status).toBe("COMPLETED");
    expect(replay.responseStatus).toBe(201);
    expect(replay.responseBody).toEqual({ accepted: true });
    expect(replay.id).toBe(first.id);

    await expect(
      manager.run((tx) =>
        tx.repositories.idempotency.reserve({
          ...key,
          requestHash: Uint8Array.from({ length: 32 }, () => 6),
        }),
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });
});
