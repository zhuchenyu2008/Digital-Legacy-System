import { describe, expect, test, vi } from "vitest";
import { PostgresOwnerSystemHealthRuntime } from "./owner-system-health.runtime";

describe("owner system health runtime", () => {
  test("summarizes operational evidence without exposing provider details", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.startsWith("SELECT clock_timestamp")) {
        return { rows: [{ server_now: "2026-08-09T06:00:00.000Z" }] };
      }
      if (sql.includes("domain_outbox")) return { rows: [{ count: 2 }] };
      if (sql.includes("notification_attempts")) {
        return { rows: [{ finished_at: "2026-08-09T05:58:00.000Z", result: "TEMP_FAIL" }] };
      }
      if (sql.includes("audit.private_events")) {
        return { rows: [{ occurred_at: "2026-08-09T05:55:00.000Z" }] };
      }
      throw new Error("postgresql://user:secret@host/db");
    });
    const runtime = new PostgresOwnerSystemHealthRuntime(
      { query } as never,
      {
        driver: "filesystem",
        privateRoot: ".data/private",
        stagingRoot: ".data/staging",
        publicRoot: ".data/public",
      },
      vi.fn().mockResolvedValue(true),
    );

    const result = await runtime.read();

    expect(result).toMatchObject({
      serverNow: "2026-08-09T06:00:00.000Z",
      pendingJobs: 2,
      categories: expect.arrayContaining([
        { code: "database", status: "ok" },
        { code: "storage", status: "ok", backend: "local-volume" },
        { code: "worker", status: "unknown", lastSeenAt: null },
        { code: "smtp", status: "degraded", lastSeenAt: "2026-08-09T05:58:00.000Z" },
      ]),
    });
    expect(JSON.stringify(result)).not.toMatch(/postgresql:\/\/|secret|path|credential/iu);
  });

  test("returns safe degraded categories when the database probe fails", async () => {
    const runtime = new PostgresOwnerSystemHealthRuntime(
      { query: vi.fn().mockRejectedValue(new Error("raw provider failure")) } as never,
      {
        driver: "s3",
        endpoint: "https://s3.example.test",
        region: "test",
        forcePathStyle: false,
        privateBucket: "private",
        publicBucket: "public",
        accessKeyId: "not-exposed",
        secretAccessKey: "not-exposed",
      },
      vi.fn().mockResolvedValue(false),
    );

    const result = await runtime.read();

    expect(result.categories).toContainEqual({ code: "database", status: "degraded" });
    expect(result.categories).toContainEqual({
      code: "storage",
      status: "unknown",
      backend: "s3-compatible",
    });
    expect(JSON.stringify(result)).not.toContain("raw provider failure");
  });
});
