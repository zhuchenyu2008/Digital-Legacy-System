import type { JobPayload } from "@dls/application";
import type { Pool } from "pg";

import { JOB_NAMES } from "./job-names.js";

export interface JobPublisher {
  publish(name: string, payload: JobPayload): Promise<void>;
}

const EVENT_JOB_ROUTES: Readonly<Record<string, string>> = Object.freeze({
  CHECKIN_EVALUATE_REQUESTED: JOB_NAMES.CHECKIN_EVALUATE,
  WORKFLOW_FRAGMENT_SUBMITTED: JOB_NAMES.PROCESS_RELEASE_FRAGMENT,
  WORKFLOW_ADVANCE_REQUESTED: JOB_NAMES.WORKFLOW_ADVANCE,
  NOTIFICATION_DELIVER_REQUESTED: JOB_NAMES.NOTIFICATION_DELIVER,
  PUBLICATION_FINALIZE_REQUESTED: JOB_NAMES.PUBLICATION_FINALIZE,
});

function extractJobPayload(value: unknown, fallbackAggregateId: string): JobPayload {
  if (!value || typeof value !== "object") {
    return { aggregateId: fallbackAggregateId, aggregateVersion: 0 };
  }
  const payload = value as Record<string, unknown>;
  if (payload.aggregateId === undefined && payload.aggregateVersion === undefined) {
    return { aggregateId: fallbackAggregateId, aggregateVersion: 0 };
  }
  if (typeof payload.aggregateId !== "string" || !Number.isSafeInteger(payload.aggregateVersion)) {
    throw new Error("Outbox job identity is invalid");
  }
  const aggregateVersion = Number(payload.aggregateVersion);
  if (aggregateVersion < 0) throw new Error("Outbox job version is invalid");
  return {
    aggregateId: payload.aggregateId,
    aggregateVersion,
  };
}

export class PgOutboxDispatcher {
  readonly #pool: Pick<Pool, "connect">;
  readonly #publisher: JobPublisher;

  constructor(pool: Pick<Pool, "connect">, publisher: JobPublisher) {
    this.#pool = pool;
    this.#publisher = publisher;
  }

  async dispatchBatch(limit = 100): Promise<number> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
      throw new RangeError("Outbox batch limit must be between 1 and 1000");
    }
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `SELECT id, event_type, aggregate_id, payload
         FROM app.domain_outbox
         WHERE published_at IS NULL AND available_at <= clock_timestamp()
         ORDER BY created_at, id
         FOR UPDATE SKIP LOCKED LIMIT $1`,
        [limit],
      );
      let dispatched = 0;
      for (const row of result.rows) {
        const payload = extractJobPayload(row.payload, String(row.aggregate_id));
        await this.#publisher.publish(
          EVENT_JOB_ROUTES[String(row.event_type)] ?? JOB_NAMES.OUTBOX_DISPATCH,
          payload,
        );
        await client.query(
          `UPDATE app.domain_outbox
           SET published_at = clock_timestamp()
           WHERE id = $1 AND published_at IS NULL`,
          [row.id],
        );
        dispatched += 1;
      }
      await client.query("COMMIT");
      return dispatched;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the broker or database error.
      }
      throw error;
    } finally {
      client.release();
    }
  }
}
