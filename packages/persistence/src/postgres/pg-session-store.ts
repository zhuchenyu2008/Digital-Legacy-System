import type { SessionActorType, SessionRecord, SessionStore } from "@dls/application";
import type { Pool } from "pg";

type Queryable = Pick<Pool, "query">;

function digestBytes(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

function digestString(value: unknown, column: string): string {
  if (!(value instanceof Uint8Array)) throw new Error(`${column} is not binary`);
  return Buffer.from(value).toString("base64url");
}

function instant(value: unknown, column: string): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && Number.isFinite(Date.parse(value))) {
    return new Date(value).toISOString();
  }
  throw new Error(`${column} is not a timestamp`);
}

function optionalInstant(value: unknown, column: string): string | undefined {
  return value === null || value === undefined ? undefined : instant(value, column);
}

function optionalDigest(value: unknown, column: string): string | undefined {
  return value === null || value === undefined ? undefined : digestString(value, column);
}

function sessionRecord(row: Record<string, unknown>): SessionRecord {
  const actorType = row.actor_type;
  if (actorType !== "OWNER" && actorType !== "CONTACT") {
    throw new Error("actor_type is invalid");
  }
  const sessionId = row.id;
  const actorId = row.actor_id;
  const credentialVersion = Number(row.credential_version);
  if (typeof sessionId !== "string" || typeof actorId !== "string") {
    throw new Error("session identity is invalid");
  }
  if (!Number.isSafeInteger(credentialVersion) || credentialVersion < 0) {
    throw new Error("credential_version is invalid");
  }
  const revokedAt = optionalInstant(row.revoked_at, "revoked_at");
  const ipDigest = optionalDigest(row.ip_hmac, "ip_hmac");
  const userAgentDigest = optionalDigest(row.user_agent_hmac, "user_agent_hmac");
  return Object.freeze({
    sessionId,
    actorType,
    actorId,
    credentialVersion,
    createdAt: instant(row.created_at, "created_at"),
    lastSeenAt: instant(row.last_seen_at, "last_seen_at"),
    idleExpiresAt: instant(row.idle_expires_at, "idle_expires_at"),
    absoluteExpiresAt: instant(row.absolute_expires_at, "absolute_expires_at"),
    tokenHash: digestString(row.session_token_hash, "session_token_hash"),
    csrfTokenHash: digestString(row.csrf_token_hash, "csrf_token_hash"),
    ...(revokedAt === undefined ? {} : { revokedAt }),
    ...(ipDigest === undefined ? {} : { ipDigest }),
    ...(userAgentDigest === undefined ? {} : { userAgentDigest }),
  });
}

const SESSION_COLUMNS = `
  id,
  session_token_hash,
  csrf_token_hash,
  actor_type,
  actor_id,
  credential_version,
  created_at,
  last_seen_at,
  idle_expires_at,
  absolute_expires_at,
  revoked_at,
  ip_hmac,
  user_agent_hmac`;

export class PgSessionStore implements SessionStore {
  public constructor(private readonly database: Queryable) {}

  public async create(record: SessionRecord): Promise<void> {
    await this.database.query(
      `INSERT INTO app.auth_sessions (
         id,
         session_token_hash,
         csrf_token_hash,
         token_hmac_key_version,
         actor_type,
         actor_id,
         credential_version,
         created_at,
         last_seen_at,
         idle_expires_at,
         absolute_expires_at,
         revoked_at,
         ip_hmac,
         user_agent_hmac
       ) VALUES ($1, $2, $3, 1, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        record.sessionId,
        digestBytes(record.tokenHash),
        digestBytes(record.csrfTokenHash),
        record.actorType,
        record.actorId,
        record.credentialVersion,
        record.createdAt,
        record.lastSeenAt,
        record.idleExpiresAt,
        record.absoluteExpiresAt,
        record.revokedAt ?? null,
        record.ipDigest === undefined ? null : digestBytes(record.ipDigest),
        record.userAgentDigest === undefined ? null : digestBytes(record.userAgentDigest),
      ],
    );
  }

  public async findByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    const result = await this.database.query(
      `SELECT ${SESSION_COLUMNS}
       FROM app.auth_sessions
       WHERE session_token_hash = $1`,
      [digestBytes(tokenHash)],
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row === undefined ? null : sessionRecord(row);
  }

  public async listActive(
    actorType: SessionActorType,
    actorId: string,
    now: string,
  ): Promise<readonly SessionRecord[]> {
    const result = await this.database.query(
      `SELECT ${SESSION_COLUMNS}
       FROM app.auth_sessions
       WHERE actor_type = $1
         AND actor_id = $2
         AND revoked_at IS NULL
         AND idle_expires_at > $3::timestamptz
         AND absolute_expires_at > $3::timestamptz
       ORDER BY created_at, id`,
      [actorType, actorId, now],
    );
    return result.rows.map((row) => sessionRecord(row as Record<string, unknown>));
  }

  public async revoke(sessionId: string, revokedAt: string): Promise<void> {
    await this.database.query(
      `UPDATE app.auth_sessions
       SET revoked_at = COALESCE(revoked_at, $2::timestamptz)
       WHERE id = $1`,
      [sessionId, revokedAt],
    );
  }

  public async touch(sessionId: string, lastSeenAt: string, idleExpiresAt: string): Promise<void> {
    await this.database.query(
      `UPDATE app.auth_sessions
       SET last_seen_at = $2::timestamptz,
           idle_expires_at = $3::timestamptz
       WHERE id = $1`,
      [sessionId, lastSeenAt, idleExpiresAt],
    );
  }
}
