import type { Pool } from "pg";

import type { JobPayload } from "@dls/application";

import { JOB_NAMES } from "./job-names.js";

export interface JobPublisher {
  publish(name: string, payload: JobPayload): Promise<void>;
}

function extractJobPayload(value: unknown): JobPayload {
  if (!value || typeof value !== "object") throw new Error("Outbox payload is not an object");
  const payload = value as Record<string, unknown>;
  if (
    typeof payload.aggregateId !== "string" ||
    !Number.isSafeInteger(payload.aggregateVersion) ||
    Number(payload.aggregateVersion) < 0
  ) {
    throw new Error("Outbox payload must contain aggregateId and aggregateVersion");
  }
  return {
    aggregateId: payload.aggregateId,
    aggregateVersion: Number(payload.aggregateVersion),
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
        `SELECT id, payload
         FROM app.domain_outbox
         WHERE published_at IS NULL AND available_at <= clock_timestamp()
         ORDER BY created_at, id
         FOR UPDATE SKIP LOCKED LIMIT $1`,
        [limit],
      );
      let dispatched = 0;
      for (const row of result.rows) {
        const payload = extractJobPayload(row.payload);
        await this.#publisher.publish(JOB_NAMES.OUTBOX_DISPATCH, payload);
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
