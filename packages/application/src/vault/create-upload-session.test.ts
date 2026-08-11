import { describe, expect, it } from "vitest";
import { CreateUploadSession } from "./create-upload-session.js";
import type { VaultPackageRecord, VaultPackageRepository } from "./ports.js";

function metadata() {
  return {
    vaultId: "vault-1",
    shareGenerationId: "generation-1",
    cipherAlgorithm: "XCHACHA20_POLY1305_SECRETSTREAM_V1",
    streamHeader: new Uint8Array(24),
    ciphertextSize: 1,
    ciphertextSha256: "aa".repeat(32),
    dekEnvelope: new Uint8Array([1]),
    dekEnvelopeNonce: new Uint8Array([2]),
    dekEnvelopeAlgorithm: "xchacha20poly1305-ietf",
    dekEnvelopeProtocolVersion: 1,
    dekEnvelopeAadHash: new Uint8Array([3]),
    manifestCiphertext: new Uint8Array([4]),
    manifestNonce: new Uint8Array([5]),
    manifestAlgorithm: "xchacha20poly1305-ietf",
    manifestAadHash: new Uint8Array([6]),
    clientCryptoVersion: "test",
    expiresAt: "2026-08-10T13:00:00Z",
  } as const;
}

describe("CreateUploadSession", () => {
  it("keeps the browser package identity and version in the authenticated metadata", async () => {
    const created: VaultPackageRecord[] = [];
    const packages: VaultPackageRepository = {
      create: async (record) => {
        created.push(record);
        return record;
      },
      findById: async () => null,
      findActive: async () => null,
      findCurrentShareGenerationId: async () => "generation-1",
      lockVault: async () => undefined,
      update: async () => {
        throw new Error("not used");
      },
      list: async () => [],
    };
    const result = await new CreateUploadSession({
      packages,
      idFactory: () => "server-id",
      objectKeyFactory: (id) => `objects/${id}`,
      nextVersionNo: async () => 2,
    }).execute({
      ...metadata(),
      packageId: "client-package-id",
      packageVersion: 7,
    });

    expect(result.package.id).toBe("client-package-id");
    expect(result.package.versionNo).toBe(7);
    expect(created[0]?.id).toBe("client-package-id");
    expect(created[0]?.versionNo).toBe(7);
  });
});
