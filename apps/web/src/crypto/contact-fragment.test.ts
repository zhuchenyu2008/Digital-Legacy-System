import { beforeEach, describe, expect, test, vi } from "vitest";

const cryptoMocks = vi.hoisted(() => ({
  openShareV1: vi.fn(async () => new Uint8Array([7, 8, 9])),
  sealFragmentIngressV1: vi.fn(async (input: Record<string, unknown>) => ({
    generationId: input.generationId,
    shareIndex: input.shareIndex,
    commitmentDigest: input.commitmentDigest,
    ingressKeyVersion: input.ingressKeyVersion,
    nonce: "sealed-nonce",
    ciphertext: "sealed-ciphertext",
  })),
}));

vi.mock("@dls/crypto/browser", () => ({
  contactKeyId: vi.fn(async () => "contact-key-id"),
  decodeBase64Url: (value: string) => new Uint8Array(Buffer.from(value, "base64url")),
  deriveBrowserKey: vi.fn(async () => new Uint8Array(32).fill(1)),
  encodeBase64Url: (value: Uint8Array) => Buffer.from(value).toString("base64url"),
  openShareV1: cryptoMocks.openShareV1,
  sealFragmentIngressV1: cryptoMocks.sealFragmentIngressV1,
  unwrapContactPrivateKey: vi.fn(async () => new Uint8Array(32).fill(2)),
}));

import { createContactFragment } from "./contact-fragment";

const encoded = (fill: number) => Buffer.from(new Uint8Array(32).fill(fill)).toString("base64url");

describe("contact recovery fragment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("derives the envelope commitment digest from the stored VSS commitments", async () => {
    const shareCommitment = encoded(5);
    const commitmentDigest = Buffer.from(
      await crypto.subtle.digest("SHA-256", Buffer.from(shareCommitment, "base64url")),
    ).toString("base64url");

    await createContactFragment({
      password: "contact-password-2026",
      workflowId: "workflow-1",
      purpose: "RECOVERY",
      vaultId: "vault-1",
      contactId: "contact-1",
      threshold: 2,
      publicKey: encoded(3),
      privateKeyEnvelope: {
        ciphertext: encoded(4),
        nonce: encoded(6),
        kdfSalt: encoded(7),
      },
      share: {
        generationId: "generation-1",
        shareIndex: 1,
        protocolVersion: 1,
        ciphertext: encoded(8),
        commitment: shareCommitment,
      },
      ingress: {
        purpose: "RECOVERY",
        version: 1,
        publicKey: encoded(9),
      },
    });

    expect(cryptoMocks.openShareV1).toHaveBeenCalledWith(
      expect.objectContaining({
        envelope: expect.objectContaining({ commitmentDigest }),
      }),
    );
    expect(cryptoMocks.sealFragmentIngressV1).toHaveBeenCalledWith(
      expect.objectContaining({ commitmentDigest }),
    );
  });
});
