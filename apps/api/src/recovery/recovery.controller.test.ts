import { UnauthorizedException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { ContactRecoveryController, OwnerRecoveryController } from "./recovery.controller.js";
import type { RecoveryRuntime } from "./recovery.runtime.js";

describe("password recovery controllers", () => {
  it("keeps the anonymous request response generic", async () => {
    const request = vi.fn(async () => ({
      accepted: true as const,
      message: "如果系统已完成配置，启动邮件将被发送",
    }));
    const controller = new OwnerRecoveryController({ request } as unknown as RecoveryRuntime);

    await expect(controller.request({ id: "request-1" } as never)).resolves.toEqual({
      data: { accepted: true, message: "如果系统已完成配置，启动邮件将被发送" },
      requestId: "request-1",
    });
    expect(request).toHaveBeenCalledWith("request-1");
  });

  it("derives the approving contact from the authenticated principal", async () => {
    const approve = vi.fn(async () => ({
      approved: true as const,
      approvedCount: 1,
      thresholdReached: false,
      workflowState: "AWAITING_APPROVALS" as const,
    }));
    const controller = new ContactRecoveryController({ approve } as unknown as RecoveryRuntime);
    const body = {
      password: "contact-password",
      generationId: "generation-1",
      shareIndex: 1,
      commitmentDigest: Buffer.alloc(32, 1).toString("base64url"),
      ingressKeyVersion: 2,
      protocolVersion: 1,
      nonce: Buffer.alloc(24, 2).toString("base64url"),
      ciphertext: Buffer.alloc(96, 3).toString("base64url"),
    };

    await controller.approve("workflow-1", body, {
      id: "request-2",
      user: { actorId: "contact-from-session" },
    } as never);
    expect(approve).toHaveBeenCalledWith({
      workflowId: "workflow-1",
      contactId: "contact-from-session",
      password: "contact-password",
      requestId: "request-2",
      fragment: expect.objectContaining({
        generationId: "generation-1",
        shareIndex: 1,
        commitmentDigest: expect.any(Uint8Array),
        nonce: expect.any(Uint8Array),
        ciphertext: expect.any(Uint8Array),
      }),
    });
    await expect(
      controller.approve("workflow-1", body, { id: "request-3" } as never),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("encodes sealed recovery material without exposing server key material", async () => {
    const material = vi.fn(async () => ({
      workflowId: "workflow-1",
      vaultId: "vault-1",
      resetSessionToken: "one-time-session",
      encryptedVaultKey: new Uint8Array(80).fill(4),
      sealedVaultKeyDigest: new Uint8Array(32).fill(5),
      expiresAt: "2026-08-09T03:00:00Z",
    }));
    const controller = new OwnerRecoveryController({ material } as unknown as RecoveryRuntime);

    await expect(
      controller.material(
        {
          token: "reset-link",
          emailVerificationCode: "12345678",
          clientEphemeralPublicKey: Buffer.alloc(32, 6).toString("base64url"),
        },
        { id: "request-4" } as never,
      ),
    ).resolves.toMatchObject({
      data: {
        workflowId: "workflow-1",
        vaultId: "vault-1",
        resetSessionToken: "one-time-session",
        encryptedVaultKey: Buffer.alloc(80, 4).toString("base64url"),
        sealedVaultKeyDigest: Buffer.alloc(32, 5).toString("base64url"),
      },
    });
  });
});
