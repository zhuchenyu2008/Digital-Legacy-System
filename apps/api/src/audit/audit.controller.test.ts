import { describe, expect, test, vi } from "vitest";
import { AuditController } from "./audit.controller";
import type { AuditRuntime } from "./audit.runtime";

describe("owner audit controller", () => {
  test("lists, verifies, and requires password reauthentication for detail", async () => {
    const runtime = {
      list: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
      integrity: vi
        .fn()
        .mockResolvedValue({ valid: true, entries: 3, lastSequence: 3, lastHash: "hash" }),
      detail: vi.fn().mockResolvedValue({ eventId: "event-1", metadataDigest: "digest" }),
    } as unknown as AuditRuntime;
    const controller = new AuditController(runtime);

    await expect(controller.list(undefined, undefined, undefined, "20")).resolves.toEqual({
      items: [],
      nextCursor: null,
    });
    await expect(controller.integrity()).resolves.toMatchObject({ valid: true, entries: 3 });
    await expect(controller.detail("event-1", { password: "owner-password" })).resolves.toEqual({
      eventId: "event-1",
      metadataDigest: "digest",
    });
    expect(runtime.detail).toHaveBeenCalledWith("event-1", "owner-password");
  });
});
