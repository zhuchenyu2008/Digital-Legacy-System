import { ReleaseAdvanceCriticalError } from "@dls/application";
import { JOB_NAMES } from "@dls/persistence";
import { describe, expect, it, vi } from "vitest";
import { WorkflowAdvanceHandler } from "./workflow-advance.handler.js";

describe("workflow advance handler", () => {
  it("passes durable aggregate identity to the application use case", async () => {
    const advance = vi.fn(async () => ({ status: "STALE" as const }));
    const handler = new WorkflowAdvanceHandler(advance);
    await handler.handle({
      id: "job-1",
      name: JOB_NAMES.WORKFLOW_ADVANCE,
      data: { aggregateId: "workflow-1", aggregateVersion: 4 },
    });
    expect(advance).toHaveBeenCalledWith({ workflowId: "workflow-1", aggregateVersion: 4 });
  });

  it("reports critical stage-key failures and rethrows for broker retry/dead-letter", async () => {
    const failure = new ReleaseAdvanceCriticalError("stage key unavailable");
    const reportCritical = vi.fn();
    const handler = new WorkflowAdvanceHandler(async () => Promise.reject(failure), reportCritical);
    await expect(
      handler.handle({
        id: "job-2",
        name: JOB_NAMES.WORKFLOW_ADVANCE,
        data: { aggregateId: "workflow-1", aggregateVersion: 4 },
      }),
    ).rejects.toBe(failure);
    expect(reportCritical).toHaveBeenCalledWith(failure);
  });
});
