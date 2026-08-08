import { describe, expect, it, vi } from "vitest";
import { ShareGenerationController } from "../../apps/api/src/shares/share-generation.controller.js";
import type { ShareGenerationRuntime } from "../../apps/api/src/shares/share-generation.runtime.js";

describe("share generation HTTP contract", () => {
  it("does not trust client thresholds and returns the server snapshot", async () => {
    const runtime = {
      create: vi.fn(async () => ({
        generationId: "generation-1",
        generationNo: 1,
        status: "PREPARING" as const,
        contactCount: 4,
        deathThreshold: 3,
        recoveryThreshold: 3,
        contactsSnapshotSha256: "00".repeat(32),
        protocolVersion: 1 as const,
        vssScheme: "AUDITED_PUBLICLY_VERIFIABLE_SHARING_V1" as const,
        contacts: [],
      })),
    } as unknown as ShareGenerationRuntime;
    const controller = new ShareGenerationController(runtime);

    const response = await controller.create(
      {
        vaultId: "vault-1",
        contactSetVersion: 8,
        expectedCurrentGenerationId: "generation-0",
      },
      { id: "request-1", user: { actorId: "owner-1" } } as never,
    );

    expect(response.deathThreshold).toBe(3);
    expect(response.recoveryThreshold).toBe(3);
    expect(runtime.create).toHaveBeenCalledWith({
      vaultId: "vault-1",
      contactSetVersion: 8,
      expectedCurrentGenerationId: "generation-0",
      ownerId: "owner-1",
      requestId: "request-1",
    });
  });

  it("passes uploaded encrypted material through the strict DTO boundary", async () => {
    const runtime = {
      upload: vi.fn(async () => ({
        generationId: "generation-1",
        status: "PREPARING" as const,
        contactCount: 3,
        deathThreshold: 3,
        recoveryThreshold: 2,
        generationCommitment: "00".repeat(32),
        vkCommitment: "11".repeat(32),
        uploadedShareCount: 3,
      })),
    } as unknown as ShareGenerationRuntime;
    const controller = new ShareGenerationController(runtime);
    const encoded = Buffer.alloc(48, 4).toString("base64url");
    const commitment = Buffer.alloc(32, 5).toString("base64url");
    const response = await controller.upload(
      "generation-1",
      {
        contactSetVersion: 8,
        contactsSnapshotSha256: "00".repeat(32),
        protocolVersion: 1,
        vssScheme: "AUDITED_PUBLICLY_VERIFIABLE_SHARING_V1",
        generationCommitment: commitment,
        vkCommitment: "11".repeat(32),
        generationProof: commitment,
        shares: [1, 2, 3].map((index) => ({
          contactId: `contact-${index}`,
          shareIndex: index,
          deathShareCiphertext: encoded,
          recoveryShareCiphertext: encoded,
          deathShareCommitment: commitment,
          recoveryShareCommitment: commitment,
        })),
      },
      { id: "request-2", user: { actorId: "owner-1" } } as never,
    );
    expect(response.uploadedShareCount).toBe(3);
    expect(runtime.upload).toHaveBeenCalledWith(
      expect.objectContaining({
        generationId: "generation-1",
        ownerId: "owner-1",
        requestId: "request-2",
        shares: expect.arrayContaining([
          expect.objectContaining({ contactId: "contact-1", shareIndex: 1 }),
        ]),
      }),
    );
  });
});
