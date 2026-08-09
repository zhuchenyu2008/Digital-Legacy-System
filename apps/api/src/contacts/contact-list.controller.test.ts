import { describe, expect, test } from "vitest";
import type { ContactRuntime } from "./contact.runtime.js";
import { ContactInvitationsController } from "./contact-invitations.controller.js";

describe("owner contact list", () => {
  test("returns only the sanitized owner projection", async () => {
    const runtime = {
      list: async () => [
        {
          id: "c1",
          displayName: "张伟",
          email: "zhang@example.com",
          status: "ACTIVE",
          consentVersion: "1",
        },
      ],
    } as unknown as ContactRuntime;
    const controller = new ContactInvitationsController(runtime);
    await expect(controller.list({ id: "request-1" } as never)).resolves.toEqual({
      data: [
        {
          id: "c1",
          displayName: "张伟",
          email: "zhang@example.com",
          status: "ACTIVE",
          consentVersion: "1",
        },
      ],
      requestId: "request-1",
    });
  });
});
