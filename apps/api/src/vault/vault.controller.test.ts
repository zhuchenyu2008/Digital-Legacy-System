import { describe, expect, test, vi } from "vitest";
import { VaultController } from "./vault.controller.js";
import type { VaultRuntime } from "./vault.runtime.js";

describe("VaultController", () => {
  test("resolves the singleton owner vault without accepting a client-selected vault header", async () => {
    const listPackages = vi.fn(async () => [
      {
        id: "package-1",
        vaultId: "vault-1",
        versionNo: 1,
        status: "ACTIVE",
        ciphertextSize: 12,
        ciphertextSha256: "ab".repeat(32),
        expiresAt: "2026-08-09T07:00:00.000Z",
      },
    ]);
    const runtime = {
      listPackages,
    } as unknown as VaultRuntime;
    const controller = new VaultController(runtime);

    await expect(
      controller.list({ user: { actorId: "owner-1" }, id: "request-1" } as never),
    ).resolves.toEqual([
      expect.objectContaining({ id: "package-1", vaultId: "vault-1", status: "ACTIVE" }),
    ]);
    expect(listPackages).toHaveBeenCalledWith(expect.objectContaining({ ownerId: "owner-1" }));
  });
});
