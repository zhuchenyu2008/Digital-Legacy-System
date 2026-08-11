import { describe, expect, it } from "vitest";
import { decryptPackageManifestV1, encryptPackageManifestV1 } from "./package-crypto.js";

const context = {
  vaultId: "00000000-0000-4000-8000-000000000001",
  packageId: "00000000-0000-4000-8000-000000000002",
  packageVersion: 7,
};

describe("encrypted package manifest v1", () => {
  it("round trips a manifest and binds it to the package context", async () => {
    const key = new Uint8Array(32).fill(7);
    const manifest = {
      version: 1,
      algorithm: "secretstream-xchacha20poly1305",
      plaintextBytes: 123,
      ciphertextBytes: 456,
      plaintextSha256: "aa".repeat(32),
      ciphertextSha256: "bb".repeat(32),
      frameCount: 2,
      streamHeader: "cc".repeat(24),
    } as const;

    const encrypted = await encryptPackageManifestV1({ key, context, manifest });
    expect(encrypted.algorithm).toBe("xchacha20poly1305-ietf");
    expect(encrypted.nonce).toHaveLength(24);
    expect(encrypted.aadHash).toHaveLength(32);
    expect(await decryptPackageManifestV1({ key, context, encrypted })).toEqual(manifest);
    await expect(
      decryptPackageManifestV1({
        key,
        context: { ...context, packageVersion: 8 },
        encrypted,
      }),
    ).rejects.toThrow();
  });
});
