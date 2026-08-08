import type { OutboxEvent, OutboxRecord, OutboxWriter } from "@dls/application";
import type { PoolClient } from "pg";

export class PgOutboxWriter implements OutboxWriter {
  readonly #client: Pick<PoolClient, "query">;

  constructor(client: Pick<PoolClient, "query">) {
    this.#client = client;
  }

  async enqueue(event: OutboxEvent): Promise<OutboxRecord> {
    const inserted = await this.#client.query(
      `INSERT INTO app.domain_outbox
       (event_type, aggregate_type, aggregate_id, payload, idempotency_key, available_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, COALESCE($6::timestamptz, clock_timestamp()))
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id, event_type, aggregate_type, aggregate_id, payload, idempotency_key, available_at`,
      [
        event.eventType,
        event.aggregateType,
        event.aggregateId,
        JSON.stringify(event.payload),
        event.idempotencyKey,
        event.availableAt ?? null,
      ],
    );
    const row =
      (inserted.rows[0] as Record<string, unknown> | undefined) ??
      ((
        await this.#client.query(
          `SELECT id, event_type, aggregate_type, aggregate_id, payload, idempotency_key, available_at
           FROM app.domain_outbox WHERE idempotency_key = $1`,
          [event.idempotencyKey],
        )
      ).rows[0] as Record<string, unknown> | undefined);
    if (row === undefined) throw new Error("Outbox insert returned no row");
    return {
      id: String(row.id),
      eventType: String(row.event_type),
      aggregateType: String(row.aggregate_type),
      aggregateId: String(row.aggregate_id),
      payload: row.payload as Readonly<Record<string, unknown>>,
      idempotencyKey: String(row.idempotency_key),
      availableAt: String(row.available_at),
    };
  }
}
