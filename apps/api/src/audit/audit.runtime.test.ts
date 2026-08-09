import { describe, expect, test, vi } from "vitest";
import {
  decodeAuditCursor,
  encodeAuditCursor,
  PostgresAuditRuntime,
  projectAuditRow,
} from "./audit.runtime";

describe("private audit projection", () => {
  test("returns only allowlisted fields and an opaque cursor", () => {
    const projected = projectAuditRow({
      sequence_no: "42",
      event_id: "00000000-0000-0000-0000-000000000042",
      occurred_at: "2026-08-09T06:00:00.000Z",
      event_type: "OWNER_LOGIN_CHECKIN",
      actor_type: "OWNER",
      actor_pseudonym: Buffer.from("actor-secret"),
      target_type: "owner",
      target_id: "00000000-0000-0000-0000-000000000001",
      result: "SUCCESS",
      request_id: "00000000-0000-0000-0000-000000000099",
      metadata_ciphertext: Buffer.from("private-metadata"),
      ip_ciphertext: Buffer.from("127.0.0.1"),
      user_agent_ciphertext: Buffer.from("browser"),
      previous_hash: Buffer.alloc(32, 1),
      event_hash: Buffer.alloc(32, 2),
    });

    expect(projected).toEqual({
      sequence: 42,
      eventId: "00000000-0000-0000-0000-000000000042",
      occurredAt: "2026-08-09T06:00:00.000Z",
      eventType: "OWNER_LOGIN_CHECKIN",
      actorType: "OWNER",
      targetType: "owner",
      targetId: "00000000-0000-0000-0000-000000000001",
      result: "SUCCESS",
      requestId: "00000000-0000-0000-0000-000000000099",
      eventHash: "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI",
    });
    expect(JSON.stringify(projected)).not.toMatch(
      /ciphertext|password|token|private-metadata|127\.0\.0\.1|browser/iu,
    );
    const cursor = encodeAuditCursor(42);
    expect(cursor).not.toBe("42");
    expect(decodeAuditCursor(cursor)).toBe(42);
  });

  test("paginates newest-first and reauthenticates before returning ciphertext digests", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("app.owner_credentials")) return { rows: [{ password_phc: "hash" }] };
      if (sql.includes("WHERE event_id")) {
        return {
          rows: [
            {
              sequence_no: "42",
              event_id: "00000000-0000-0000-0000-000000000042",
              occurred_at: "2026-08-09T06:00:00.000Z",
              event_type: "OWNER_LOGIN_CHECKIN",
              actor_type: "OWNER",
              target_type: "owner",
              target_id: "00000000-0000-0000-0000-000000000001",
              result: "SUCCESS",
              request_id: "00000000-0000-0000-0000-000000000099",
              metadata_ciphertext: Buffer.from("metadata"),
              ip_ciphertext: Buffer.from("ip"),
              user_agent_ciphertext: Buffer.from("ua"),
              event_hash: Buffer.alloc(32, 2),
            },
          ],
        };
      }
      return {
        rows: [
          {
            sequence_no: "42",
            event_id: "00000000-0000-0000-0000-000000000042",
            occurred_at: "2026-08-09T06:00:00.000Z",
            event_type: "OWNER_LOGIN_CHECKIN",
            actor_type: "OWNER",
            target_type: "owner",
            target_id: "00000000-0000-0000-0000-000000000001",
            result: "SUCCESS",
            request_id: "00000000-0000-0000-0000-000000000099",
            event_hash: Buffer.alloc(32, 2),
          },
          {
            sequence_no: "41",
            event_id: "00000000-0000-0000-0000-000000000041",
            occurred_at: "2026-08-09T05:00:00.000Z",
            event_type: "OWNER_LOGIN",
            actor_type: "OWNER",
            target_type: "owner",
            target_id: "00000000-0000-0000-0000-000000000001",
            result: "SUCCESS",
            request_id: null,
            event_hash: Buffer.alloc(32, 1),
          },
        ],
      };
    });
    const runtime = new PostgresAuditRuntime({ query } as never, {
      passwordVerifier: vi.fn().mockResolvedValue(true),
      verifyTable: vi.fn().mockResolvedValue({ valid: true, entries: 42 }),
    });

    await expect(runtime.list({ limit: 1 })).resolves.toMatchObject({
      items: [{ sequence: 42 }],
      nextCursor: expect.any(String),
    });
    const detail = await runtime.detail("00000000-0000-0000-0000-000000000042", "owner-password");
    expect(detail).toMatchObject({
      eventId: "00000000-0000-0000-0000-000000000042",
      metadataDigest: expect.any(String),
      ipDigest: expect.any(String),
      userAgentDigest: expect.any(String),
    });
    expect(JSON.stringify(detail)).not.toMatch(
      /private-metadata|127\.0\.0\.1|browser|ciphertext/iu,
    );
  });
});
