import { describe, expect, it, vi } from "vitest";
import type { ContactRuntime } from "../../apps/api/src/contacts/contact.runtime.js";
import { ContactPasswordController } from "../../apps/api/src/contacts/contact-auth.controller.js";
import { ContactInvitationsController } from "../../apps/api/src/contacts/contact-invitations.controller.js";

describe("contact security HTTP contract", () => {
  it("does not return the raw password-change token to the owner", async () => {
    const rawToken = "raw-contact-password-token";
    const runtime = {
      requestPasswordChange: vi.fn(async () => ({
        contactId: "contact-1",
        token: rawToken,
        expiresAt: "2026-08-09T14:00:00.000Z",
      })),
    } as unknown as ContactRuntime;
    const controller = new ContactInvitationsController(runtime);

    const response = await controller.requestPasswordChange(
      "contact-1",
      { password: "owner-password" },
      {
        id: "018f28a8-7f9a-7b32-9e41-4454f1c75691",
        user: { actorId: "owner-1" },
      } as never,
    );

    expect(JSON.stringify(response)).not.toContain(rawToken);
    expect(runtime.requestPasswordChange).toHaveBeenCalledWith({
      contactId: "contact-1",
      ownerId: "owner-1",
      password: "owner-password",
      requestId: "018f28a8-7f9a-7b32-9e41-4454f1c75691",
    });
  });

  it("returns configuring status after owner removal", async () => {
    const runtime = {
      remove: vi.fn(async () => ({
        contactId: "contact-1",
        status: "CONFIGURING" as const,
      })),
    } as unknown as ContactRuntime;
    const controller = new ContactInvitationsController(runtime);

    const response = await controller.remove("contact-1", { password: "owner-password" }, {
      id: "018f28a8-7f9a-7b32-9e41-4454f1c75692",
      user: { actorId: "owner-1" },
    } as never);

    expect(response.data).toEqual({ contactId: "contact-1", status: "CONFIGURING" });
    expect(runtime.remove).toHaveBeenCalledWith({
      contactId: "contact-1",
      ownerId: "owner-1",
      password: "owner-password",
      requestId: "018f28a8-7f9a-7b32-9e41-4454f1c75692",
    });
  });

  it("rotates the contact session without exposing private key plaintext", async () => {
    const runtime = {
      changePassword: vi.fn(async () => ({
        contactId: "contact-1",
        session: {
          token: "new-session-token",
          csrfToken: "csrf-token",
          principal: {
            idleExpiresAt: "2026-08-08T15:00:00.000Z",
            absoluteExpiresAt: "2026-08-09T14:00:00.000Z",
          },
        },
        privateKeyPlaintext: "must-not-be-returned",
      })),
    } as unknown as ContactRuntime;
    const controller = new ContactPasswordController(runtime);

    const response = await controller.complete(
      {
        oldPassword: "old-password",
        newPassword: "new-password-123",
        newPrivateKeyEnvelope: {
          publicKey: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE",
          ciphertext: "Y2lwaGVydGV4dA",
          nonce: "YWFhYWFhYWFhYWFh",
          kdfSalt: "YmJiYmJiYmJiYmJiYmJiYg",
          kdfParams: {},
          privateKeyProof: "cHJvb2Y",
        },
      },
      {
        id: "018f28a8-7f9a-7b32-9e41-4454f1c75693",
        sessionToken: "old-session-token",
      } as never,
      { header: vi.fn() } as never,
    );

    expect(JSON.stringify(response)).not.toContain("privateKeyPlaintext");
    expect(runtime.changePassword).toHaveBeenCalledWith(
      expect.objectContaining({
        currentSessionToken: "old-session-token",
        oldPassword: "old-password",
        newPassword: "new-password-123",
      }),
    );
  });
});
