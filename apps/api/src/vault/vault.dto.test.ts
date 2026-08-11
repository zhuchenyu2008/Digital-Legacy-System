import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { decodeBase64Url, parseCreateVaultUpload } from "./vault.dto.js";

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");

function body() {
  return {
    packageId: "00000000-0000-0000-0000-000000000099",
    packageVersion: 7,
    vaultId: "00000000-0000-0000-0000-000000000001",
    shareGenerationId: "00000000-0000-0000-0000-000000000010",
    cipherAlgorithm: "XCHACHA20_POLY1305_SECRETSTREAM_V1",
    streamHeader: b64(new Uint8Array(24)),
    encryptedSize: 12,
    ciphertextSha256: "a".repeat(64),
    dekEnvelope: b64(new Uint8Array([1])),
    dekEnvelopeNonce: b64(new Uint8Array([2])),
    dekEnvelopeAlgorithm: "XCHACHA20_POLY1305",
    dekEnvelopeProtocolVersion: 1,
    dekEnvelopeAadHash: b64(new Uint8Array([3])),
    manifestCiphertext: b64(new Uint8Array([4])),
    manifestNonce: b64(new Uint8Array([5])),
    manifestAlgorithm: "XCHACHA20_POLY1305",
    manifestAadHash: b64(new Uint8Array([6])),
    clientCryptoVersion: "1",
  };
}

describe("vault upload API DTOs", () => {
  it("maps strict base64url metadata to application bytes", () => {
    const parsed = parseCreateVaultUpload(body(), "2026-08-08T13:00:00.000Z");
    expect(parsed.streamHeader).toHaveLength(24);
    expect(parsed.dekEnvelope).toEqual(new Uint8Array([1]));
    expect(parsed.packageId).toBe("00000000-0000-0000-0000-000000000099");
    expect(parsed.packageVersion).toBe(7);
    expect(parsed.expiresAt).toBe("2026-08-08T13:00:00.000Z");
  });

  it("rejects empty, padded, and malformed base64url values", () => {
    for (const value of ["", "a=", "a+b", "a"] as const) {
      expect(() => decodeBase64Url(value, "payload")).toThrow(BadRequestException);
    }
  });
});
