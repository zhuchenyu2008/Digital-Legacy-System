import { createHash } from "node:crypto";
import type { PoolClient } from "pg";

import type {
  IdempotencyKey,
  IdempotencyReservation,
  IdempotencyRepository,
} from "@dls/application";

import { PersistenceError, mapDatabaseError } from "./errors.js";

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

function asReservation(row: Record<string, unknown>): IdempotencyReservation {
  return {
    id: String(row.id),
    actorScope: String(row.actor_scope),
    commandName: String(row.command_name),
    keyDigest: Uint8Array.from(row.key_digest as Buffer),
    requestHash: Uint8Array.from(row.request_hash as Buffer),
    status: row.status as IdempotencyReservation["status"],
    ...(row.response_status === null || row.response_status === undefined
      ? {}
      : { responseStatus: Number(row.response_status) }),
    ...(row.response_body === null || row.response_body === undefined
      ? {}
      : { responseBody: row.response_body }),
    ...(row.response_hash === null || row.response_hash === undefined
      ? {}
      : { responseHash: Uint8Array.from(row.response_hash as Buffer) }),
  };
}

export class PgIdempotencyRepository implements IdempotencyRepository {
  readonly #client: Pick<PoolClient, "query">;

  constructor(client: Pick<PoolClient, "query">) {
    this.#client = client;
  }

  async reserve(key: IdempotencyKey): Promise<IdempotencyReservation> {
    const inserted = await this.#client.query(
      `INSERT INTO app.idempotency_records
       (actor_scope, command_name, key_digest, request_hash, status)
       VALUES ($1, $2, $3, $4, 'IN_PROGRESS')
       ON CONFLICT (actor_scope, command_name, key_digest) DO NOTHING
       RETURNING *`,
      [key.actorScope, key.commandName, Buffer.from(key.keyDigest), Buffer.from(key.requestHash)],
    );
    const row =
      (inserted.rows[0] as Record<string, unknown> | undefined) ??
      (
        await this.#client.query(
          `SELECT * FROM app.idempotency_records
           WHERE actor_scope = $1 AND command_name = $2 AND key_digest = $3
           FOR UPDATE`,
          [key.actorScope, key.commandName, Buffer.from(key.keyDigest)],
        )
      ).rows[0] as Record<string, unknown> | undefined;
    if (row === undefined) throw new PersistenceError("DATABASE_ERROR", "Idempotency record was not found");
    if (!Buffer.from(row.request_hash as Buffer).equals(Buffer.from(key.requestHash))) {
      throw new PersistenceError("IDEMPOTENCY_CONFLICT", "Idempotency key was reused for a different request");
    }
    return asReservation(row);
  }

  async complete(id: string, responseStatus: number, responseBody: unknown): Promise<IdempotencyReservation> {
    const responseHash = createHash("sha256").update(canonicalJson(responseBody), "utf8").digest();
    try {
      const result = await this.#client.query(
        `UPDATE app.idempotency_records
         SET status = 'COMPLETED', response_status = $2, response_body = $3::jsonb,
             response_hash = $4, completed_at = clock_timestamp()
         WHERE id = $1 AND status = 'IN_PROGRESS'
         RETURNING *`,
        [id, responseStatus, JSON.stringify(responseBody), responseHash],
      );
      const row = result.rows[0] as Record<string, unknown> | undefined;
      if (row === undefined) throw new PersistenceError("NOT_FOUND", "Idempotency record is not in progress");
      return asReservation(row);
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }
}
