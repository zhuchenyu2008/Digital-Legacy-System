import { describe, expect, test, vi } from "vitest";
import { HealthController } from "./health.controller.js";
import { HealthService } from "./health.service.js";

describe("HealthController", () => {
  test("reports process liveness without checking dependencies", () => {
    const database = { check: vi.fn() };
    const storage = { check: vi.fn() };
    const heartbeat = { check: vi.fn() };
    const controller = new HealthController(new HealthService(database, storage, heartbeat));

    expect(controller.live()).toEqual({ status: "ok", service: "api", version: "0.1.0" });
    expect(database.check).not.toHaveBeenCalled();
    expect(storage.check).not.toHaveBeenCalled();
    expect(heartbeat.check).not.toHaveBeenCalled();
  });

  test("checks PostgreSQL, storage, and worker heartbeat readiness", async () => {
    const database = { check: vi.fn().mockResolvedValue(undefined) };
    const storage = { check: vi.fn().mockResolvedValue(undefined) };
    const heartbeat = { check: vi.fn().mockResolvedValue(undefined) };
    const controller = new HealthController(new HealthService(database, storage, heartbeat));

    await expect(controller.ready()).resolves.toEqual({
      status: "ok",
      service: "api",
      version: "0.1.0",
      checks: { database: "ok", storage: "ok", workerHeartbeat: "ok" },
    });
    expect(database.check).toHaveBeenCalledOnce();
    expect(storage.check).toHaveBeenCalledOnce();
    expect(heartbeat.check).toHaveBeenCalledOnce();
  });

  test("fails readiness when a dependency is unavailable", async () => {
    const controller = new HealthController(
      new HealthService(
        { check: vi.fn().mockRejectedValue(new Error("database unavailable")) },
        { check: vi.fn() },
        { check: vi.fn() },
      ),
    );

    await expect(controller.ready()).rejects.toThrow("database unavailable");
  });
});
