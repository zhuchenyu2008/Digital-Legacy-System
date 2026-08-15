import { describe, expect, test } from "vitest";
import { PublicController } from "./public.controller.js";
import type { PublicRuntime } from "./public.runtime.js";

describe("public status projection", () => {
  test("returns aggregate-only workflow state", async () => {
    const runtime = {
      status: async () => ({
        state: "IN_PROGRESS",
        serverNow: "2026-08-09T06:00:00.000Z",
      }),
    } as unknown as PublicRuntime;
    const controller = new PublicController(runtime);
    await expect(controller.status()).resolves.toEqual({
      state: "IN_PROGRESS",
      serverNow: "2026-08-09T06:00:00.000Z",
    });
    const result = await controller.status();
    expect(JSON.stringify(result)).not.toMatch(
      /PASSWORD_RECOVERY|approvedCount|requiredCount|releaseAt/iu,
    );
  });
});
