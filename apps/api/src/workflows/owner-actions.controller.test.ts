import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { OwnerActionsController } from "./owner-actions.controller.js";
import type { WorkflowRuntime } from "./workflows.runtime.js";

describe("owner workflow actions controller", () => {
  it("derives owner identity from the authenticated principal and requires a password", async () => {
    const cancelDeath = vi.fn(async () => ({
      cancelled: true as const,
      workflowState: "CANCELLED" as const,
      endedAt: "2026-08-10T02:29:59.999Z",
    }));
    const controller = new OwnerActionsController({ cancelDeath } as unknown as WorkflowRuntime);
    const request = {
      id: "request-1",
      user: { actorId: "owner-from-session", actorType: "OWNER" as const },
    };

    await expect(
      controller.cancel("workflow-1", { password: "correct-password" }, request as never),
    ).resolves.toMatchObject({ data: { workflowState: "CANCELLED" } });
    expect(cancelDeath).toHaveBeenCalledWith({
      workflowId: "workflow-1",
      ownerId: "owner-from-session",
      password: "correct-password",
      requestId: "request-1",
    });

    await expect(
      controller.cancel("workflow-1", { password: "correct-password" }, {
        id: "request-2",
      } as never),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      controller.cancel("workflow-1", { password: "" }, request as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
