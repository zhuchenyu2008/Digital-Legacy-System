import { describe, expect, it } from "vitest";
import type { ContactRuntime } from "../../apps/api/src/contacts/contact.runtime.js";
import { ContactInvitationsController } from "../../apps/api/src/contacts/contact-invitations.controller.js";

describe("contact invitation HTTP contract", () => {
  it("does not echo the raw invitation token in the owner response", async () => {
    const rawToken = "raw-invitation-token-must-stay-in-mailer";
    const runtime = {
      invite: async () => ({
        contactId: "contact-1",
        invitationId: "invitation-1",
        token: rawToken,
        expiresAt: "2026-08-11T14:00:00Z",
      }),
    } as unknown as ContactRuntime;
    const controller = new ContactInvitationsController(runtime);
    const response = await controller.invite({ displayName: "李四", email: "lisi@example.com" }, {
      id: "018f28a8-7f9a-7b32-9e41-4454f1c75691",
      user: { actorId: "owner-1" },
    } as never);
    expect(JSON.stringify(response)).not.toContain(rawToken);
    expect(response).toMatchObject({
      data: { contactId: "contact-1", invitationId: "invitation-1" },
    });
  });
});
