import type { CanonicalAuditEvent } from "@dls/application";
import { parseInstant } from "@dls/domain";
import { hashAuditEvent } from "@dls/application";
import type { PoolClient } from "pg";

export type AuditChainEntry = Readonly<{
  event: CanonicalAuditEvent;
  eventHash: Uint8Array;
}>;

export class AuditVerificationError extends Error {
  readonly code = "AUDIT_CHAIN_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "AuditVerificationError";
  }
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function normalizeDatabaseInstant(value: unknown): string {
  const text = String(value).replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00");
  return parseInstant(text);
}

export function verifyAuditChain(
  entries: readonly AuditChainEntry[],
): Readonly<{ valid: true; entries: number }> {
  let expectedSequence = 1;
  let previousHash: Uint8Array<ArrayBufferLike> = new Uint8Array(32);
  for (const entry of entries) {
    if (entry.event.sequence !== expectedSequence) {
      throw new AuditVerificationError(
        `Audit sequence is not contiguous: expected ${expectedSequence}, got ${entry.event.sequence}`,
      );
    }
    if (!equalBytes(entry.event.previousHash, previousHash)) {
      throw new AuditVerificationError(`Audit previous hash mismatch at sequence ${expectedSequence}`);
    }
    const calculatedHash = hashAuditEvent(entry.event);
    if (!equalBytes(entry.eventHash, calculatedHash)) {
      throw new AuditVerificationError(`Audit event hash mismatch at sequence ${expectedSequence}`);
    }
    previousHash = entry.eventHash;
    expectedSequence += 1;
  }
  return { valid: true, entries: entries.length };
}

export async function verifyPrivateAuditTable(
  client: Pick<PoolClient, "query">,
): Promise<Readonly<{ valid: true; entries: number }>> {
  const result = await client.query(
    `SELECT sequence_no, occurred_at::text AS occurred_at, event_type, actor_type,
            actor_pseudonym, target_type, target_id, metadata_ciphertext, previous_hash, event_hash
     FROM audit.private_events ORDER BY sequence_no`,
  );
  const entries: AuditChainEntry[] = result.rows.map((row) => ({
    event: {
      sequence: Number(row.sequence_no),
      occurredAt: normalizeDatabaseInstant(row.occurred_at),
      eventType: String(row.event_type),
      actorType: String(row.actor_type),
      actorIdDigest: Uint8Array.from((row.actor_pseudonym as Buffer | null) ?? new Uint8Array(32)),
      aggregateType: String(row.target_type ?? "system"),
      aggregateId: String(row.target_id ?? "00000000-0000-0000-0000-000000000000"),
      payload: {
        digest: Buffer.from(
          (row.metadata_ciphertext as Buffer | null) ?? new Uint8Array(32),
        ).toString("base64url"),
      },
      previousHash: Uint8Array.from(row.previous_hash as Buffer),
    },
    eventHash: Uint8Array.from(row.event_hash as Buffer),
  }));
  return verifyAuditChain(entries);
}

export async function verifyPublicAuditTable(
  client: Pick<PoolClient, "query">,
  publicationId?: string,
): Promise<Readonly<{ valid: true; entries: number }>> {
  const result = await client.query(
    `SELECT publication_id, sequence_no, occurred_at::text AS occurred_at, event_code,
            public_message, public_metadata, previous_hash, event_hash
     FROM audit.public_events
     ${publicationId === undefined ? "" : "WHERE publication_id = $1"}
     ORDER BY publication_id, sequence_no`,
    publicationId === undefined ? undefined : [publicationId],
  );
  let total = 0;
  for (const group of Map.groupBy(result.rows, (row) => String(row.publication_id)).values()) {
    const entries: AuditChainEntry[] = group.map((row) => ({
      event: {
        sequence: Number(row.sequence_no),
        occurredAt: normalizeDatabaseInstant(row.occurred_at),
        eventType: String(row.event_code),
        actorType: "PUBLIC",
        actorIdDigest: new Uint8Array(32),
        aggregateType: "publication",
        aggregateId: String(row.publication_id),
        payload: { message: row.public_message, metadata: row.public_metadata },
        previousHash: Uint8Array.from(row.previous_hash as Buffer),
      },
      eventHash: Uint8Array.from(row.event_hash as Buffer),
    }));
    verifyAuditChain(entries);
    total += entries.length;
  }
  return { valid: true, entries: total };
}
