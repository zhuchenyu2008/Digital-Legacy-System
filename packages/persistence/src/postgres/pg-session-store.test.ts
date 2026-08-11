import type { SessionRecord } from "@dls/application";
import { describe, expect, it, vi } from "vitest";
import { PgSessionStore } from "./pg-session-store.js";

const record: SessionRecord = Object.freeze({
  sessionId: "11111111-1111-4111-8111-111111111111",
  actorType: "OWNER",
  actorId: "00000000-0000-0000-0000-000000000001",
  credentialVersion: 0,
  createdAt: "2026-08-11T14:00:00.000Z",
  lastSeenAt: "2026-08-11T14:01:00.000Z",
  idleExpiresAt: "2026-08-11T14:31:00.000Z",
  absoluteExpiresAt: "2026-08-12T14:00:00.000Z",
  tokenHash: "AQIDBA",
  csrfTokenHash: "BQYHCA",
  ipDigest: "CQoLDA",
  userAgentDigest: "DQ4PEA",
});

function databaseRow() {
  return {
    id: record.sessionId,
    actor_type: record.actorType,
    actor_id: record.actorId,
    credential_version: String(record.credentialVersion),
    created_at: new Date(record.createdAt),
    last_seen_at: new Date(record.lastSeenAt),
    idle_expires_at: new Date(record.idleExpiresAt),
    absolute_expires_at: new Date(record.absoluteExpiresAt),
    revoked_at: null,
    session_token_hash: Buffer.from(record.tokenHash, "base64url"),
    csrf_token_hash: Buffer.from(record.csrfTokenHash, "base64url"),
    ip_hmac: Buffer.from(record.ipDigest ?? "", "base64url"),
    user_agent_hmac: Buffer.from(record.userAgentDigest ?? "", "base64url"),
  };
}

describe("PostgreSQL session store", () => {
  it("persists and restores every secret digest needed after an API restart", async () => {
    const query = vi.fn(async (sql: string, _values?: readonly unknown[]) => ({
      rows: /^\s*SELECT/iu.test(sql) ? [databaseRow()] : [],
    }));
    const store = new PgSessionStore({ query } as never);

    await store.create(record);
    await expect(store.findByTokenHash(record.tokenHash)).resolves.toEqual(record);

    const insertValues = query.mock.calls[0]?.[1] as readonly unknown[];
    expect(Buffer.from(insertValues[1] as Uint8Array).toString("base64url")).toBe(record.tokenHash);
    expect(Buffer.from(insertValues[2] as Uint8Array).toString("base64url")).toBe(
      record.csrfTokenHash,
    );
  });

  it("queries active sessions and persists revocation and idle renewal", async () => {
    const query = vi.fn(async (sql: string, _values?: readonly unknown[]) => ({
      rows: /SELECT/iu.test(sql) ? [databaseRow()] : [],
    }));
    const store = new PgSessionStore({ query } as never);

    await expect(
      store.listActive(record.actorType, record.actorId, "2026-08-11T14:02:00.000Z"),
    ).resolves.toEqual([record]);
    await store.revoke(record.sessionId, "2026-08-11T14:03:00.000Z");
    await store.touch(record.sessionId, "2026-08-11T14:04:00.000Z", "2026-08-11T14:34:00.000Z");

    expect(query.mock.calls.map(([sql]) => String(sql).trim().split(/\s+/u)[0])).toEqual([
      "SELECT",
      "UPDATE",
      "UPDATE",
    ]);
  });
});
