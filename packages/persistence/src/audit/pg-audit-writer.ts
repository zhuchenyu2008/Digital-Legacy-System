import type { AuditWriter } from "@dls/application";

import { type AuditEvent, hashAuditEvent, hashAuditPayload } from "@dls/application";
import type { PoolClient } from "pg";

const ZERO_HASH = new Uint8Array(32);
const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

const PUBLIC_EVENT_CODES = new Set([
  "WORKFLOW_TRIGGERED",
  "CONFIRMATION_PROGRESS",
  "THRESHOLD_REACHED",
  "SECOND_STAGE_REMINDER",
  "PUBLICATION_LOCKED",
  "PUBLICATION_COMPLETE",
  "IP_SUMMARY",
]);
const PUBLIC_METADATA_KEYS = new Set([
  "contactCount",
  "approvedCount",
  "threshold",
  "stage",
  "packageVersion",
  "ipSummary",
  "zipSha256",
]);

export type PublicAuditInput = Readonly<{
  eventCode: string;
  publicMessage: string;
  metadata: Readonly<Record<string, unknown>>;
}>;

export type PublicAuditProjection = Readonly<{
  eventCode: string;
  publicMessage: string;
  publicMetadata: Readonly<Record<string, string | number | boolean>>;
}>;

export function projectPublicEvent(input: PublicAuditInput): PublicAuditProjection {
  if (!PUBLIC_EVENT_CODES.has(input.eventCode)) {
    throw new Error(`Public audit event code is not allowlisted: ${input.eventCode}`);
  }
  const publicMessage = input.publicMessage.normalize("NFC");
  if (/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|[0-9a-f]{8}-[0-9a-f-]{27,}/i.test(publicMessage)) {
    throw new Error("Public audit message contains personally identifying data");
  }
  const publicMetadata: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(input.metadata)) {
    if (!PUBLIC_METADATA_KEYS.has(key)) continue;
    if (
      typeof value === "string" ||
      typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value))
    ) {
      publicMetadata[key] = value;
    }
  }
  return { eventCode: input.eventCode, publicMessage, publicMetadata };
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
    const previousHash = Uint8Array.from(
      (last.rows[0]?.event_hash as Buffer | undefined) ?? ZERO_HASH,
    );
    const sequenceResult = await this.#client.query(
      "SELECT nextval('audit.private_events_sequence_no_seq')::bigint AS sequence_no",
    );
    const sequence = Number(sequenceResult.rows[0]?.sequence_no);
    if (!Number.isSafeInteger(sequence) || sequence < 1) {
      throw new Error("Audit sequence generator returned an invalid value");
    }
    const payloadDigest = hashAuditPayload(event.payload ?? {});
    const canonicalEvent = {
      sequence,
      occurredAt: event.occurredAt,
      eventType: event.eventType,
      actorType: event.actorType,
      actorIdDigest: event.actorIdDigest ?? event.actorPseudonym ?? ZERO_HASH,
      aggregateType: event.aggregateType ?? event.targetType ?? "system",
      aggregateId: event.aggregateId ?? event.targetId ?? ZERO_UUID,
      payload: { digest: Buffer.from(payloadDigest).toString("base64url") },
      previousHash,
    } as const;
    const eventHash = hashAuditEvent(canonicalEvent);

    await this.#client.query(
      `INSERT INTO audit.private_events
       (sequence_no, event_id, occurred_at, event_type, actor_type, actor_pseudonym,
        target_type, target_id, result, request_id, metadata_ciphertext, previous_hash, event_hash)
       OVERRIDING SYSTEM VALUE
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        sequence,
        event.eventId,
        event.occurredAt,
        event.eventType,
        event.actorType,
        event.actorIdDigest ?? event.actorPseudonym ?? null,
        event.aggregateType ?? event.targetType ?? null,
        event.aggregateId ?? event.targetId ?? null,
        event.result,
        event.requestId ?? null,
        Buffer.from(payloadDigest),
        Buffer.from(previousHash),
        Buffer.from(eventHash),
      ],
    );
  }
}

export async function appendPublicAuditEvent(
  client: Pick<PoolClient, "query">,
  publicationId: string,
  occurredAt: string,
  input: PublicAuditInput,
): Promise<void> {
  const projection = projectPublicEvent(input);
  await client.query("SELECT pg_advisory_xact_lock(hashtext('dls:audit:public:' || $1))", [
    publicationId,
  ]);
  const latest = await client.query(
    `SELECT sequence_no, event_hash
     FROM audit.public_events WHERE publication_id = $1
     ORDER BY sequence_no DESC LIMIT 1`,
    [publicationId],
  );
  const sequence = Number(latest.rows[0]?.sequence_no ?? 0) + 1;
  const previousHash = Uint8Array.from(
    (latest.rows[0]?.event_hash as Buffer | undefined) ?? ZERO_HASH,
  );
  const event = {
    sequence,
    occurredAt,
    eventType: projection.eventCode,
    actorType: "PUBLIC",
    actorIdDigest: ZERO_HASH,
    aggregateType: "publication",
    aggregateId: publicationId,
    payload: { message: projection.publicMessage, metadata: projection.publicMetadata },
    previousHash,
  } as const;
  const eventHash = hashAuditEvent(event);
  await client.query(
    `INSERT INTO audit.public_events
     (publication_id, sequence_no, occurred_at, event_code, public_message, public_metadata,
      previous_hash, event_hash)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`,
    [
      publicationId,
      sequence,
      occurredAt,
      projection.eventCode,
      projection.publicMessage,
      JSON.stringify(projection.publicMetadata),
      Buffer.from(previousHash),
      Buffer.from(eventHash),
    ],
  );
}
