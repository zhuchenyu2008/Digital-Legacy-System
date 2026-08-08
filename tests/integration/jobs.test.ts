import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  computeRetryDelayMs,
  JOB_NAMES,
  type JobPublisher,
  type PgBossLike,
  PgBossScheduler,
  PgOutboxDispatcher,
} from "../../packages/persistence/src/jobs/index.js";
import {
  createPgPool,
  PgTransactionManager,
} from "../../packages/persistence/src/postgres/index.js";

const pool = createPgPool({
  connectionString: process.env.DATABASE_URL ?? "postgresql://postgres:test@127.0.0.1:55432/dls",
});
const manager = new PgTransactionManager(pool);

function outboxEvent(idempotencyKey: string) {
  return {
    eventType: "TEST_JOB",
    aggregateType: "workflow",
    aggregateId: "00000000-0000-0000-0000-000000000021",
    payload: { aggregateId: "00000000-0000-0000-0000-000000000021", aggregateVersion: 4 },
    idempotencyKey,
  };
}

describe("durable jobs and outbox dispatch", () => {
  beforeEach(async () => {
    await pool.query("DELETE FROM app.domain_outbox");
  });

  afterAll(async () => {
    await pool.end();
  });

  it("publishes one logical job and marks the outbox row after acknowledgement", async () => {
    await manager.run((tx) => tx.outbox.enqueue(outboxEvent("job-test-1")));
    const published: Array<{ name: string; payload: unknown }> = [];
    const publisher: JobPublisher = {
      async publish(name, payload) {
        published.push({ name, payload });
      },
    };
    const dispatcher = new PgOutboxDispatcher(pool, publisher);

    expect(await dispatcher.dispatchBatch()).toBe(1);
    expect(published).toEqual([
      {
        name: JOB_NAMES.OUTBOX_DISPATCH,
        payload: { aggregateId: "00000000-0000-0000-0000-000000000021", aggregateVersion: 4 },
      },
    ]);
    expect(await dispatcher.dispatchBatch()).toBe(0);
    const row = await pool.query(
      "SELECT published_at FROM app.domain_outbox WHERE idempotency_key = $1",
      ["job-test-1"],
    );
    expect(row.rows[0]?.published_at).not.toBeNull();
  });

  it("keeps an outbox row available when the job broker fails", async () => {
    await manager.run((tx) => tx.outbox.enqueue(outboxEvent("job-test-retry")));
    const publisher: JobPublisher = {
      async publish() {
        throw new Error("broker unavailable");
      },
    };
    const dispatcher = new PgOutboxDispatcher(pool, publisher);

    await expect(dispatcher.dispatchBatch()).rejects.toThrow("broker unavailable");
    const row = await pool.query(
      "SELECT published_at FROM app.domain_outbox WHERE idempotency_key = $1",
      ["job-test-retry"],
    );
    expect(row.rows[0]?.published_at).toBeNull();
  });

  it("recovers the pending row after a dispatcher restart", async () => {
    await manager.run((tx) => tx.outbox.enqueue(outboxEvent("job-test-restart")));
    let attempts = 0;
    const published: unknown[] = [];
    const publisher: JobPublisher = {
      async publish(_name, payload) {
        attempts += 1;
        if (attempts === 1) throw new Error("worker crashed before acknowledgement");
        published.push(payload);
      },
    };
    const dispatcher = new PgOutboxDispatcher(pool, publisher);

    await expect(dispatcher.dispatchBatch()).rejects.toThrow(
      "worker crashed before acknowledgement",
    );
    expect(await dispatcher.dispatchBatch()).toBe(1);
    expect(published).toHaveLength(1);
    const row = await pool.query(
      "SELECT published_at FROM app.domain_outbox WHERE idempotency_key = $1",
      ["job-test-restart"],
    );
    expect(row.rows[0]?.published_at).not.toBeNull();
  });

  it("uses bounded exponential retry delay and exposes all fixed job names", () => {
    expect(computeRetryDelayMs(1, () => 0)).toBe(1_000);
    expect(computeRetryDelayMs(4, () => 1)).toBe(16_000);
    expect(computeRetryDelayMs(99, () => 1)).toBe(86_400_000);
    expect(Object.values(JOB_NAMES)).toHaveLength(7);
  });

  it("uses aggregate identity and version as the pg-boss singleton key", async () => {
    const sent: Array<{ name: string; options: Readonly<Record<string, unknown>> | undefined }> =
      [];
    const boss: PgBossLike = {
      async send(name, _payload, options) {
        sent.push({ name, options });
        return "job-id";
      },
    };
    const scheduler = new PgBossScheduler(boss);

    await expect(
      scheduler.schedule(JOB_NAMES.WORKFLOW_ADVANCE, {
        aggregateId: "aggregate-1",
        aggregateVersion: 3,
      }),
    ).resolves.toBe("job-id");
    expect(sent[0]).toEqual({
      name: JOB_NAMES.WORKFLOW_ADVANCE,
      options: { singletonKey: "workflow.advance:aggregate-1:3", retryLimit: 7 },
    });
  });
});
