import { describe, expect, test, vi } from "vitest";
import { completeOwnerRecovery } from "./recovery-reset";

describe("completeOwnerRecovery", () => {
  test("uses one ephemeral worker session for material, rewrap, and reset", async () => {
    const calls: string[] = [];
    const close = vi.fn();
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      calls.push(path);
      if (path.endsWith("/material")) {
        expect(JSON.parse(String(init?.body))).toEqual({
          token: "reset-token",
          emailVerificationCode: "12345678",
          clientEphemeralPublicKey: "ephemeral-public",
        });
        return {
          data: {
            workflowId: "workflow-1",
            vaultId: "vault-1",
            resetSessionToken: "session-token",
            encryptedVaultKey: "sealed-vault-key",
            sealedVaultKeyDigest: "sealed-digest",
            expiresAt: "2026-08-11T13:15:00Z",
          },
        };
      }
      expect(JSON.parse(String(init?.body))).toEqual({
        resetSessionToken: "session-token",
        newPassword: "new-owner-password-2026",
        newOwnerVaultEnvelope: { ciphertext: "replacement-envelope" },
        vaultKeyProof: "vault-proof",
      });
      return { data: { completed: true } };
    });
    const session = {
      createEphemeralKey: vi.fn(async () => {
        calls.push("worker:create");
        return "ephemeral-public";
      }),
      openRecoveryVault: vi.fn(async (input) => {
        calls.push("worker:open");
        expect(input).toEqual({
          workflowId: "workflow-1",
          vaultId: "vault-1",
          sealed: "sealed-vault-key",
          sealedVaultKeyDigest: "sealed-digest",
          newPassword: "new-owner-password-2026",
        });
        return {
          envelope: { ciphertext: "replacement-envelope" },
          vaultKeyProof: "vault-proof",
        };
      }),
      close,
    };

    await completeOwnerRecovery(
      {
        token: "reset-token",
        emailVerificationCode: "12345678",
        newPassword: "new-owner-password-2026",
      },
      { request: request as never, createSession: () => session },
    );

    expect(calls).toEqual([
      "worker:create",
      "/auth/owner/password-recovery/material",
      "worker:open",
      "/auth/owner/password-recovery/reset",
    ]);
    expect(close).toHaveBeenCalledOnce();
  });

  test("closes the worker when material validation fails", async () => {
    const close = vi.fn();
    await expect(
      completeOwnerRecovery(
        {
          token: "reset-token",
          emailVerificationCode: "12345678",
          newPassword: "new-owner-password-2026",
        },
        {
          request: async () => {
            throw new Error("material rejected");
          },
          createSession: () => ({
            createEphemeralKey: async () => "ephemeral-public",
            openRecoveryVault: async () => {
              throw new Error("must not run");
            },
            close,
          }),
        },
      ),
    ).rejects.toThrow("material rejected");
    expect(close).toHaveBeenCalledOnce();
  });
});
