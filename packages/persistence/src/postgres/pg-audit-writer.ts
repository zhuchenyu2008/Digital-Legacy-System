import { createHash } from "node:crypto";
import type { PoolClient } from "pg";

import type { AuditEvent, AuditWriter } from "@dls/application";

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export class PgAuditWriter implements AuditWriter {
  readonly #client: Pick<PoolClient, "query">;

  constructor(client: Pick<PoolClient, "query">) {
    this.#client = client;
  }

  async append(event: AuditEvent): Promise<void> {
    await this.#client.query("SELECT pg_advisory_xact_lock(hashtext('dls:audit:private:v1'))");
    const last = await this.#client.query(
      "SELECT event_hash FROM audit.private_events ORDER BY sequence_no DESC LIMIT 1",
    );
    const previousHash = (last.rows[0]?.event_hash as Buffer | undefined) ?? Buffer.alloc(32);
    const canonical = canonicalJson({
      eventId: event.eventId,
      occurredAt: event.occurredAt,
      eventType: event.eventType,
      actorType: event.actorType,
      actorPseudonym: event.actorPseudonym ? Buffer.from(event.actorPseudonym).toString("base64url") : null,
      targetType: event.targetType ?? null,
      targetId: event.targetId ?? null,
      result: event.result,
      requestId: event.requestId ?? null,
      metadata: event.metadata ?? null,
    });
    const eventHash = createHash("sha256")
      .update(previousHash)
      .update(canonical, "utf8")
      .digest();
    await this.#client.query(
      `INSERT INTO audit.private_events
       (event_id, occurred_at, event_type, actor_type, actor_pseudonym, target_type, target_id,
        result, request_id, previous_hash, event_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        event.eventId,
        event.occurredAt,
        event.eventType,
        event.actorType,
        event.actorPseudonym ? Buffer.from(event.actorPseudonym) : null,
        event.targetType ?? null,
        event.targetId ?? null,
        event.result,
        event.requestId ?? null,
        previousHash,
        eventHash,
      ],
    );
  }
}
