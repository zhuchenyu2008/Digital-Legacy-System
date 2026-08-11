import { describe, expect, it, vi } from "vitest";
import { abortPackageUpload, runPackageUploadFlow } from "./package-upload-flow.js";

describe("package upload browser flow", () => {
  it("binds browser encryption to the reserved package identity and activates only after completion", async () => {
    const calls: Array<{ path: string; init?: RequestInit }> = [];
    const uploads: Array<{ path: string; body: Blob; headers: HeadersInit }> = [];
    const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
      calls.push({ path, ...(init === undefined ? {} : { init }) });
      if (path === "/owner/vault/material") {
        return {
          vaultId: "vault-1",
          activeShareGenerationId: "generation-1",
          nextPackageVersion: 4,
          activePackage: { id: "package-3", versionNo: 3, status: "ACTIVE" },
          ownerVaultEnvelope: { ciphertext: "owner-cipher", nonce: "owner-nonce", kdfSalt: "salt" },
        } as T;
      }
      if (path === "/owner/packages/uploads") {
        return {
          package: { id: "package-client-id", versionNo: 4, status: "UPLOADING" },
          upload: {
            mode: "API_STREAM",
            method: "PUT",
            url: "/owner/packages/package-client-id/content",
            uploadId: "upload-4",
          },
        } as T;
      }
      if (path.endsWith("/complete")) return { id: "package-client-id", status: "READY" } as T;
      if (path.endsWith("/activate")) return { id: "package-client-id", status: "ACTIVE" } as T;
      throw new Error(`unexpected ${path}`);
    };

    const result = await runPackageUploadFlow(
      new File([new Uint8Array([1, 2, 3])], "legacy.zip", { type: "application/zip" }),
      "owner-password-2026",
      {
        request,
        upload: async (input) => {
          uploads.push(input);
        },
        prepare: async (input) => {
          expect(input.vaultId).toBe("vault-1");
          expect(input.packageId).toBe("package-client-id");
          expect(input.packageVersion).toBe(4);
          return {
            ciphertext: new Blob([new Uint8Array([8, 9])], { type: "application/octet-stream" }),
            streamHeader: "aa",
            ciphertextSize: 2,
            ciphertextSha256: "bb".repeat(32),
            dekEnvelope: "cc",
            dekEnvelopeNonce: "dd",
            dekEnvelopeAlgorithm: "xchacha20poly1305-ietf",
            dekEnvelopeProtocolVersion: 1,
            dekEnvelopeAadHash: "ee",
            manifestCiphertext: "ff",
            manifestNonce: "gg",
            manifestAlgorithm: "xchacha20poly1305-ietf",
            manifestAadHash: "hh",
            clientCryptoVersion: "dls-web-test-v1",
          };
        },
        idFactory: () => "package-client-id",
      },
    );

    expect(result).toEqual({ id: "package-client-id", status: "ACTIVE" });
    expect(calls.map((call) => call.path)).toEqual([
      "/owner/vault/material",
      "/owner/packages/uploads",
      "/owner/packages/package-client-id/complete",
      "/owner/packages/package-client-id/activate",
    ]);
    expect(JSON.parse(String(calls[1]?.init?.body))).toMatchObject({
      packageId: "package-client-id",
      packageVersion: 4,
      vaultId: "vault-1",
      shareGenerationId: "generation-1",
    });
    expect(String(calls[1]?.init?.body)).not.toContain("owner-password-2026");
    expect(uploads).toHaveLength(1);
    expect(uploads[0]?.path).toBe("/owner/packages/package-client-id/content");
    expect(JSON.parse(String(calls[2]?.init?.body))).toMatchObject({
      uploadId: "upload-4",
      ciphertextSize: 2,
      ciphertextSha256: "bb".repeat(32),
    });
    expect(JSON.parse(String(calls[3]?.init?.body))).toMatchObject({
      password: "owner-password-2026",
      expectedCurrentPackageId: "package-3",
      expectedShareGenerationId: "generation-1",
    });
  });

  it("retries the same upload session once after a transient transport failure", async () => {
    let attempts = 0;
    const request = async <T>(path: string): Promise<T> => {
      if (path === "/owner/vault/material") {
        return {
          vaultId: "vault-1",
          activeShareGenerationId: "generation-1",
          nextPackageVersion: 1,
          ownerVaultEnvelope: { ciphertext: "owner-cipher", nonce: "owner-nonce", kdfSalt: "salt" },
        } as T;
      }
      if (path === "/owner/packages/uploads") {
        return {
          package: { id: "package-1", versionNo: 1, status: "UPLOADING" },
          upload: { uploadId: "upload-1" },
        } as T;
      }
      if (path.endsWith("/complete")) return { id: "package-1", status: "READY" } as T;
      if (path.endsWith("/activate")) return { id: "package-1", status: "ACTIVE" } as T;
      throw new Error(`unexpected ${path}`);
    };

    await runPackageUploadFlow(
      new File([new Uint8Array([1])], "legacy.zip", { type: "application/zip" }),
      "owner-password-2026",
      {
        request,
        upload: async () => {
          attempts += 1;
          if (attempts === 1)
            throw Object.assign(new Error("temporary network error"), { status: 503 });
        },
        prepare: async () => ({
          ciphertext: new Blob([new Uint8Array([8])], { type: "application/octet-stream" }),
          streamHeader: "aa",
          ciphertextSize: 1,
          ciphertextSha256: "bb".repeat(32),
          dekEnvelope: "cc",
          dekEnvelopeNonce: "dd",
          dekEnvelopeAlgorithm: "xchacha20poly1305-ietf",
          dekEnvelopeProtocolVersion: 1,
          dekEnvelopeAadHash: "ee",
          manifestCiphertext: "ff",
          manifestNonce: "gg",
          manifestAlgorithm: "xchacha20poly1305-ietf",
          manifestAadHash: "hh",
          clientCryptoVersion: "dls-web-test-v1",
        }),
        idFactory: () => "package-1",
      },
    );

    expect(attempts).toBe(2);
  });

  it("does not retry an upload after the user aborts its signal", async () => {
    const controller = new AbortController();
    let attempts = 0;
    const request = async <T>(path: string): Promise<T> => {
      if (path === "/owner/vault/material") {
        return {
          vaultId: "vault-1",
          activeShareGenerationId: "generation-1",
          nextPackageVersion: 2,
          ownerVaultEnvelope: { ciphertext: "owner-cipher", nonce: "owner-nonce", kdfSalt: "salt" },
        } as T;
      }
      if (path === "/owner/packages/uploads") {
        return {
          package: { id: "package-2", versionNo: 2, status: "UPLOADING" },
          upload: { uploadId: "upload-2" },
        } as T;
      }
      throw new Error(`unexpected ${path}`);
    };

    await expect(
      runPackageUploadFlow(
        new File([new Uint8Array([1])], "legacy.zip", { type: "application/zip" }),
        "owner-password-2026",
        {
          request,
          signal: controller.signal,
          upload: async () => {
            attempts += 1;
            controller.abort();
            throw new DOMException("upload aborted", "AbortError");
          },
          prepare: async () => ({
            ciphertext: new Blob([new Uint8Array([8])], { type: "application/octet-stream" }),
            streamHeader: "aa",
            ciphertextSize: 1,
            ciphertextSha256: "bb".repeat(32),
            dekEnvelope: "cc",
            dekEnvelopeNonce: "dd",
            dekEnvelopeAlgorithm: "xchacha20poly1305-ietf",
            dekEnvelopeProtocolVersion: 1,
            dekEnvelopeAadHash: "ee",
            manifestCiphertext: "ff",
            manifestNonce: "gg",
            manifestAlgorithm: "xchacha20poly1305-ietf",
            manifestAadHash: "hh",
            clientCryptoVersion: "dls-web-test-v1",
          }),
          idFactory: () => "package-2",
        },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(attempts).toBe(1);
  });

  it("aborts the exact server upload session without putting its token in the URL", async () => {
    const request = vi.fn().mockResolvedValue(undefined);

    await abortPackageUpload(
      { packageId: "package-2", uploadId: "upload-secret-2" },
      { request, idFactory: () => "abort-request-2" },
    );

    expect(request).toHaveBeenCalledWith("/owner/packages/package-2/abort", {
      method: "POST",
      headers: {
        "idempotency-key": "abort-request-2",
        "x-upload-id": "upload-secret-2",
      },
    });
    expect(request.mock.calls[0]?.[0]).not.toContain("upload-secret-2");
  });
});
