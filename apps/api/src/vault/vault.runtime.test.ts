import { describe, expect, test } from "vitest";
import { PostgresVaultRuntime, type VaultRequestContext } from "./vault.runtime.js";

describe("PostgresVaultRuntime owner vault material", () => {
  test("returns only the encrypted owner envelope and current share roster context", async () => {
    const transaction = {
      run: async (work: (tx: unknown) => Promise<unknown>) =>
        work({
          repositories: {
            vaults: {
              findFirst: async () => ({
                id: "vault-1",
                active_share_generation_id: "generation-7",
                owner_vault_envelope: Buffer.from([1, 2, 3]),
                owner_envelope_nonce: Buffer.from([4, 5, 6]),
                owner_kdf_salt: Buffer.from([7, 8, 9]),
                owner_kdf_params: {
                  algorithm: "argon2id",
                  memoryKiB: 65_536,
                  iterations: 3,
                  parallelism: 1,
                  version: 19,
                  purpose: "owner-vault-kek-v1",
                },
              }),
            },
            systemSettings: {
              findById: async () => ({ contact_set_version: 4 }),
            },
            packages: {
              findMany: async () => [
                {
                  id: "package-3",
                  version_no: 3,
                  status: "ACTIVE",
                  ciphertext_sha256: Buffer.alloc(32, 9),
                },
                {
                  id: "package-2",
                  version_no: 2,
                  status: "SUPERSEDED",
                  ciphertext_sha256: Buffer.alloc(32, 8),
                },
              ],
            },
          },
        }),
    };
    const runtime = new PostgresVaultRuntime(transaction as never, {} as never) as unknown as {
      getVaultMaterial(context: VaultRequestContext): Promise<unknown>;
    };

    await expect(
      runtime.getVaultMaterial({
        ownerId: "owner-1",
        csrfToken: "",
        idempotencyKey: "",
        requestId: "request-1",
      }),
    ).resolves.toEqual({
      vaultId: "vault-1",
      activeShareGenerationId: "generation-7",
      contactSetVersion: 4,
      nextPackageVersion: 4,
      activePackage: {
        id: "package-3",
        versionNo: 3,
        status: "ACTIVE",
        ciphertextSha256: "09".repeat(32),
      },
      ownerVaultEnvelope: {
        ciphertext: "AQID",
        nonce: "BAUG",
        kdfSalt: "BwgJ",
        kdfParams: {
          algorithm: "argon2id",
          memoryKiB: 65_536,
          iterations: 3,
          parallelism: 1,
          version: 19,
          purpose: "owner-vault-kek-v1",
        },
      },
    });
  });

  test("rejects a stale browser-reserved package version", async () => {
    const transaction = {
      run: async (work: (tx: unknown) => Promise<unknown>) =>
        work({
          repositories: {
            vaults: { findFirst: async () => ({ id: "vault-1" }) },
            packages: {
              findMany: async () => [{ version_no: 3 }],
            },
          },
        }),
    };
    const runtime = new PostgresVaultRuntime(transaction as never, {} as never);
    await expect(
      runtime.createUploadSession(
        {
          vaultId: "vault-1",
          shareGenerationId: "generation-1",
          packageId: "package-1",
          packageVersion: 3,
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
          expiresAt: "2026-08-10T13:00:00.000Z",
        },
        { ownerId: "owner-1", csrfToken: "", idempotencyKey: "request-1" },
      ),
    ).rejects.toMatchObject({ code: "DLS-VERSION-CONFLICT", status: 409 });
  });
});
