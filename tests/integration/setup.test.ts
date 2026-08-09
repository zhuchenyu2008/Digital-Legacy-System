import { describe, expect, it, vi } from "vitest";
import { SetupController } from "../../apps/api/src/setup/setup.controller.js";

describe("owner setup HTTP contract", () => {
  it("returns only session metadata and never echoes setup/password/key material", async () => {
    const runtime = {
      getStatus: async () => ({
        initialized: false,
        steps: {
          owner: false,
          contacts: false,
          package: false,
          smtpTest: false,
          riskAccepted: false,
        },
      }),
      createOwner: async () => ({
        ownerId: "00000000-0000-0000-0000-000000000001",
        vaultId: "00000000-0000-0000-0000-000000000002",
        session: {
          token: "server-only-token",
          csrfToken: "csrf-token",
          principal: {
            sessionId: "00000000-0000-0000-0000-000000000003",
            actorType: "OWNER" as const,
            actorId: "00000000-0000-0000-0000-000000000001",
            credentialVersion: 0,
            createdAt: "2026-08-08T14:00:00.000Z",
            lastSeenAt: "2026-08-08T14:00:00.000Z",
            idleExpiresAt: "2026-08-08T14:30:00.000Z",
            absoluteExpiresAt: "2026-08-09T14:00:00.000Z",
          },
        },
      }),
    };
    const controller = new SetupController(runtime);
    const header = vi.fn();
    const response = await controller.create(
      {
        setupToken: "setup-token",
        displayName: "张三",
        primaryEmail: "owner@example.com",
        password: "correct horse battery staple",
        ownerVaultEnvelope: {
          ciphertext: "Y2lwaGVydGV4dA",
          nonce: "YWFhYWFhYWFhYWFh",
          kdfSalt: "YmJiYmJiYmJiYmJiYmJiYg",
          kdfParams: {
            algorithm: "argon2id",
            memoryKiB: 65_536,
            iterations: 3,
            parallelism: 1,
            version: 19,
            purpose: "owner-vault-kek-v1",
          },
          keyVerifierCiphertext: "dmVyaWZpZXI",
          keyVerifierNonce: "YWFhYWFhYWFhYWFh",
          vkCommitment: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          ownerEnvelopeProof: "cHJvb2Y",
        },
      },
      { id: "018f28a8-7f9a-7b32-9e41-4454f1c75691" } as never,
      { header } as never,
    );

    const serialized = JSON.stringify(response);
    expect(serialized).toContain("csrf-token");
    expect(serialized).not.toContain("server-only-token");
    expect(serialized).not.toContain("correct horse battery staple");
    expect(serialized).not.toContain("Y2lwaGVydGV4dA");
    expect(header).toHaveBeenCalledWith("set-cookie", expect.any(Array));
  });
});
