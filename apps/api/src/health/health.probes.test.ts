import { mkdir, rm } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import {
  createStorageHealthProbe,
  PostgresHealthProbe,
  WorkerHeartbeatHealthProbe,
} from "./health.probes.js";

describe("dependency health probes", () => {
  it("executes a real PostgreSQL query", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ ok: 1 }] });
    await expect(new PostgresHealthProbe({ query } as never).check()).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledWith("SELECT 1 AS ok");
  });

  it("fails when the durable worker heartbeat is absent or stale", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await expect(
      new WorkerHeartbeatHealthProbe({ query } as never, 90_000).check(),
    ).rejects.toThrow(/stale/u);
    query.mockResolvedValue({ rows: [{ age_ms: 90_001 }] });
    await expect(
      new WorkerHeartbeatHealthProbe({ query } as never, 90_000).check(),
    ).rejects.toThrow(/stale/u);
    query.mockResolvedValue({ rows: [{ age_ms: 1_000 }] });
    await expect(
      new WorkerHeartbeatHealthProbe({ query } as never, 90_000).check(),
    ).resolves.toBeUndefined();
  });

  it("checks all filesystem storage roots", async () => {
    const root = `.acceptance-artifacts/health-probe-${Date.now()}`;
    await Promise.all([
      mkdir(`${root}/private`, { recursive: true }),
      mkdir(`${root}/staging`, { recursive: true }),
      mkdir(`${root}/public`, { recursive: true }),
    ]);
    try {
      await expect(
        createStorageHealthProbe({
          driver: "filesystem",
          privateRoot: `${root}/private`,
          stagingRoot: `${root}/staging`,
          publicRoot: `${root}/public`,
        }).check(),
      ).resolves.toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
