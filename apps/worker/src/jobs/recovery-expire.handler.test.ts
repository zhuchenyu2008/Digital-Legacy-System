import { JOB_NAMES } from "@dls/persistence";
import { describe, expect, it, vi } from "vitest";
import { RecoveryExpireHandler } from "./recovery-expire.handler.js";

describe("recovery expiry handler", () => {
  it("passes the durable recovery identity to the expiry use case", async () => {
    const expire = vi.fn(async () => ({ status: "EXPIRED" as const }));
    const handler = new RecoveryExpireHandler(expire);

    await handler.handle({
      id: "job-1",
      name: JOB_NAMES.RECOVERY_EXPIRE,
      data: { aggregateId: "workflow-1", aggregateVersion: 0 },
    });

    expect(expire).toHaveBeenCalledWith({ workflowId: "workflow-1", aggregateVersion: 0 });
  });
});
