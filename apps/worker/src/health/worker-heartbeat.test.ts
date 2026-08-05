import { describe, expect, test, vi } from "vitest";
import { WorkerHeartbeat, type WorkerHeartbeatPort } from "./worker-heartbeat.js";

describe("WorkerHeartbeat", () => {
  test("writes a durable heartbeat through its port", async () => {
    const observedAt = new Date("2026-08-05T12:00:00.000Z");
    const port: WorkerHeartbeatPort = { writeHeartbeat: vi.fn().mockResolvedValue(undefined) };
    const heartbeat = new WorkerHeartbeat(port, () => observedAt);

    await heartbeat.beat();

    expect(port.writeHeartbeat).toHaveBeenCalledWith({
      service: "worker",
      observedAt,
      version: "0.1.0",
    });
  });
});
