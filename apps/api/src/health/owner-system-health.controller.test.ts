import { describe, expect, test } from "vitest";
import { OwnerSystemHealthController } from "./owner-system-health.controller";
import type { OwnerSystemHealthRuntime } from "./owner-system-health.runtime";

describe("owner system health", () => {
  test("returns category state without credentials, paths, or raw provider errors", async () => {
    const runtime = {
      read: async () => ({
        serverNow: "2026-08-09T06:00:00.000Z",
        categories: [
          { code: "database", status: "ok" },
          { code: "storage", status: "unknown", backend: "local-volume" },
          { code: "worker", status: "unknown", lastSeenAt: null },
          { code: "deadlineScanner", status: "ok", lastSeenAt: "2026-08-09T05:55:00.000Z" },
          { code: "smtp", status: "unknown", lastSeenAt: null },
        ],
        pendingJobs: 2,
      }),
    } as OwnerSystemHealthRuntime;
    const result = await new OwnerSystemHealthController(runtime).read();
    expect(result.pendingJobs).toBe(2);
    expect(JSON.stringify(result)).not.toMatch(
      /password|secret|postgresql:\/\/|[A-Z]:\\|smtp raw/iu,
    );
  });
});
