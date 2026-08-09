import { createHash } from "node:crypto";
import { verifyServerPassword } from "@dls/crypto/node";
import { createPgPool, verifyPrivateAuditTable } from "@dls/persistence";
import { BadRequestException, NotFoundException, UnauthorizedException } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import { getApiRuntimeConfig } from "../config/api-runtime-config.js";

export const AUDIT_RUNTIME = Symbol("DLS_AUDIT_RUNTIME");

type AuditRow = Readonly<Record<string, unknown>>;
type AuditQueryable = Pick<Pool, "query"> & Partial<Pick<Pool, "connect">>;

export type PrivateAuditEvent = Readonly<{
  sequence: number;
  eventId: string;
  occurredAt: string;
  eventType: string;
  actorType: string;
  targetType?: string;
  targetId?: string;
  result: string;
  requestId?: string;
  eventHash: string;
}>;

export type AuditPage = Readonly<{
  items: readonly PrivateAuditEvent[];
  nextCursor: string | null;
}>;

export type AuditIntegrityResult = Readonly<{
  valid: true;
  entries: number;
  lastSequence: number;
  lastHash: string | null;
}>;

export type AuditDetail = PrivateAuditEvent &
  Readonly<{
    metadataDigest: string | null;
    ipDigest: string | null;
    userAgentDigest: string | null;
  }>;

export interface AuditRuntime {
  list(
    input: Readonly<{ eventType?: string; result?: string; cursor?: string; limit?: number }>,
  ): Promise<AuditPage>;
  integrity(): Promise<AuditIntegrityResult>;
  detail(eventId: string, password: string): Promise<AuditDetail>;
}

type AuditRuntimeDependencies = Readonly<{
  passwordVerifier: (password: string, hash: string) => Promise<boolean>;
  verifyTable: (
    client: Pick<PoolClient, "query">,
  ) => Promise<Readonly<{ valid: true; entries: number }>>;
}>;

function textValue(value: unknown): string {
  return String(value ?? "");
}

function optionalText(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : String(value);
}

function base64Url(value: unknown): string {
  return Buffer.from(value as Buffer | Uint8Array).toString("base64url");
}

function ciphertextDigest(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return createHash("sha256")
    .update(Buffer.from(value as Buffer | Uint8Array))
    .digest("base64url");
}

export function projectAuditRow(row: AuditRow): PrivateAuditEvent {
  const targetType = optionalText(row.target_type);
  const targetId = optionalText(row.target_id);
  const requestId = optionalText(row.request_id);
  return {
    sequence: Number(row.sequence_no),
    eventId: textValue(row.event_id),
    occurredAt: new Date(textValue(row.occurred_at)).toISOString(),
    eventType: textValue(row.event_type),
    actorType: textValue(row.actor_type),
    ...(targetType === undefined ? {} : { targetType }),
    ...(targetId === undefined ? {} : { targetId }),
    result: textValue(row.result),
    ...(requestId === undefined ? {} : { requestId }),
    eventHash: base64Url(row.event_hash),
  };
}

export function encodeAuditCursor(sequence: number): string {
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new BadRequestException("audit cursor is invalid");
  }
  return Buffer.from(`audit:v1:${sequence}`, "utf8").toString("base64url");
}

export function decodeAuditCursor(cursor: string): number {
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    const match = /^audit:v1:([1-9]\d*)$/u.exec(decoded);
    const sequence = Number(match?.[1]);
    if (!Number.isSafeInteger(sequence)) throw new Error("invalid");
    return sequence;
  } catch {
    throw new BadRequestException("audit cursor is invalid");
  }
}

function safeLimit(value: number | undefined): number {
  if (value === undefined) return 20;
  if (!Number.isSafeInteger(value) || value < 1 || value > 100) {
    throw new BadRequestException("limit must be an integer from 1 to 100");
  }
  return value;
}

export class PostgresAuditRuntime implements AuditRuntime {
  readonly #pool: AuditQueryable;
  readonly #dependencies: AuditRuntimeDependencies;

  public constructor(pool: AuditQueryable, dependencies?: Partial<AuditRuntimeDependencies>) {
    this.#pool = pool;
    const pepper = getApiRuntimeConfig().tokenPepper;
    this.#dependencies = {
      passwordVerifier:
        dependencies?.passwordVerifier ??
        ((password, hash) => verifyServerPassword(password, pepper, hash)),
      verifyTable: dependencies?.verifyTable ?? verifyPrivateAuditTable,
    };
  }

  public async list(
    input: Readonly<{ eventType?: string; result?: string; cursor?: string; limit?: number }>,
  ): Promise<AuditPage> {
    const limit = safeLimit(input.limit);
    const clauses: string[] = [];
    const values: unknown[] = [];
    if (input.cursor !== undefined) {
      values.push(decodeAuditCursor(input.cursor));
      clauses.push(`sequence_no < $${values.length}`);
    }
    if (input.eventType !== undefined && input.eventType.length > 0) {
      values.push(input.eventType);
      clauses.push(`event_type = $${values.length}`);
    }
    if (input.result !== undefined && input.result.length > 0) {
      values.push(input.result);
      clauses.push(`result = $${values.length}`);
    }
    values.push(limit + 1);
    const response = await this.#pool.query(
      `SELECT sequence_no, event_id, occurred_at::text AS occurred_at, event_type,
              actor_type, target_type, target_id, result, request_id, event_hash
       FROM audit.private_events
       ${clauses.length === 0 ? "" : `WHERE ${clauses.join(" AND ")}`}
       ORDER BY sequence_no DESC
       LIMIT $${values.length}`,
      values,
    );
    const projected = response.rows.map(projectAuditRow);
    const items = projected.slice(0, limit);
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        projected.length > limit && last !== undefined ? encodeAuditCursor(last.sequence) : null,
    };
  }

  public async integrity(): Promise<AuditIntegrityResult> {
    const client = this.#pool.connect === undefined ? this.#pool : await this.#pool.connect();
    try {
      const verified = await this.#dependencies.verifyTable(client as Pick<PoolClient, "query">);
      const latest = await client.query(
        "SELECT sequence_no, event_hash FROM audit.private_events ORDER BY sequence_no DESC LIMIT 1",
      );
      const row = latest.rows[0];
      return {
        valid: true,
        entries: verified.entries,
        lastSequence: row === undefined ? 0 : Number(row.sequence_no),
        lastHash: row === undefined ? null : base64Url(row.event_hash),
      };
    } finally {
      if ("release" in client && typeof client.release === "function") client.release();
    }
  }

  public async detail(eventId: string, password: string): Promise<AuditDetail> {
    const credentials = await this.#pool.query(
      "SELECT password_phc FROM app.owner_credentials WHERE singleton_id = true",
    );
    const hash = optionalText(credentials.rows[0]?.password_phc);
    if (hash === undefined || !(await this.#dependencies.passwordVerifier(password, hash))) {
      throw new UnauthorizedException("reauthentication failed");
    }
    const response = await this.#pool.query(
      `SELECT sequence_no, event_id, occurred_at::text AS occurred_at, event_type,
              actor_type, target_type, target_id, result, request_id, event_hash,
              metadata_ciphertext, ip_ciphertext, user_agent_ciphertext
       FROM audit.private_events WHERE event_id = $1`,
      [eventId],
    );
    const row = response.rows[0];
    if (row === undefined) throw new NotFoundException("audit event is unavailable");
    return {
      ...projectAuditRow(row),
      metadataDigest: ciphertextDigest(row.metadata_ciphertext),
      ipDigest: ciphertextDigest(row.ip_ciphertext),
      userAgentDigest: ciphertextDigest(row.user_agent_ciphertext),
    };
  }
}

export function createAuditRuntime(): AuditRuntime {
  return new PostgresAuditRuntime(
    createPgPool({ connectionString: getApiRuntimeConfig().databaseUrl }),
  );
}
