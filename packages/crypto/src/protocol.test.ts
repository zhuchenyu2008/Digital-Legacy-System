import { describe, expect, it } from "vitest";
import { deriveBrowserKey } from "./password/browser-kdf.js";
import { normalizePassword } from "./password/normalize-password.js";
import {
  hashServerPassword,
  type ServerAuthProfile,
  verifyServerPassword,
} from "./password/server-auth.js";
import { KdfProfileV1Schema } from "./protocol/algorithms.js";
import { decodeBase64Url, encodeBase64Url } from "./protocol/base64url.js";
import { type CanonicalAadInput, canonicalizeAad } from "./protocol/canonical-aad.js";
import {
  decodeWrappedKeyV1,
  encodeWrappedKeyV1,
  type WrappedKeyV1,
  WrappedKeyV1Schema,
} from "./protocol/envelopes.js";

const testKdfProfile = {
  version: 1 as const,
  algorithm: "argon2id13" as const,
  opsLimit: 2,
  memLimit: 8 * 1024,
  salt: encodeBase64Url(new Uint8Array(16).fill(7)),
  outputBytes: 32 as const,
};

const testServerProfile: ServerAuthProfile = {
  timeCost: 1,
  memoryCostKiB: 8 * 1024,
  parallelism: 1,
  hashLength: 32,
  saltBytes: 16,
};

describe("protocol v1 codecs", () => {
  it("round trips canonical base64url without padding", () => {
    const bytes = Uint8Array.from([0, 1, 2, 250, 255]);
    expect(encodeBase64Url(bytes)).toBe("AAEC-v8");
    expect(decodeBase64Url("AAEC-v8")).toEqual(bytes);
  });

  it.each(["AA=", "AA==", "AA+", "AA/", "", "A"])("rejects noncanonical base64url %s", (value) => {
    expect(() => decodeBase64Url(value)).toThrow();
  });

  it("normalizes passwords to NFC UTF-8 without trimming or folding", () => {
    expect(normalizePassword("e\u0301")).toEqual(normalizePassword("é"));
    expect(normalizePassword(" 中 国 ")).toEqual(new TextEncoder().encode(" 中 国 "));
    expect(normalizePassword("Password")).not.toEqual(normalizePassword("password"));
  });

  it("enforces NUL and UTF-8 byte limits", () => {
    expect(() => normalizePassword("bad\0password")).toThrow(/NUL/i);
    expect(normalizePassword("a".repeat(512))).toHaveLength(512);
    expect(() => normalizePassword("a".repeat(513))).toThrow(/512/);
  });

  it("rejects unknown fields and invalid fixed profile values", () => {
    const profile = {
      version: 1,
      algorithm: "argon2id13",
      opsLimit: 3,
      memLimit: 65_536,
      salt: encodeBase64Url(new Uint8Array(16)),
      outputBytes: 32,
    };
    expect(KdfProfileV1Schema.parse(profile)).toEqual(profile);
    expect(() => KdfProfileV1Schema.parse({ ...profile, extra: true })).toThrow();
    expect(() => KdfProfileV1Schema.parse({ ...profile, outputBytes: 31 })).toThrow();
    expect(() => KdfProfileV1Schema.parse({ ...profile, salt: "AA=" })).toThrow();
  });

  it("uses stable sorted canonical AAD and rejects extra fields", () => {
    const first: CanonicalAadInput = {
      protocol: "dls-v1",
      version: 1,
      purpose: "owner-vk",
      vaultId: "vault-1",
      keyId: "key-1",
      algorithm: "xchacha20poly1305-ietf",
    };
    const second: CanonicalAadInput = {
      algorithm: first.algorithm,
      keyId: first.keyId,
      vaultId: first.vaultId,
      purpose: first.purpose,
      version: first.version,
      protocol: first.protocol,
    };
    expect(canonicalizeAad(first)).toEqual(canonicalizeAad(second));
    expect(new TextDecoder().decode(canonicalizeAad(first))).toBe(
      '{"algorithm":"xchacha20poly1305-ietf","keyId":"key-1","protocol":"dls-v1","purpose":"owner-vk","vaultId":"vault-1","version":1}',
    );
    expect(() => canonicalizeAad({ ...first, unexpected: "nope" } as never)).toThrow();
  });

  it("round trips strict wrapped-key envelopes and rejects mutations", () => {
    const envelope: WrappedKeyV1 = {
      version: 1,
      algorithm: "xchacha20poly1305-ietf",
      purpose: "owner-vk",
      keyId: "key-1",
      nonce: encodeBase64Url(new Uint8Array(24)),
      ciphertext: encodeBase64Url(new Uint8Array(48)),
    };
    expect(WrappedKeyV1Schema.parse(envelope)).toEqual(envelope);
    const encoded = encodeWrappedKeyV1(envelope);
    expect(decodeWrappedKeyV1(encoded)).toEqual(envelope);
    expect(() => decodeWrappedKeyV1(`${encoded} `)).toThrow();
    expect(() => decodeWrappedKeyV1(encoded.replace("owner-vk", "unknown"))).toThrow();
  });

  it("derives a deterministic browser key from a frozen Argon2id profile", async () => {
    const first = await deriveBrowserKey("test password", testKdfProfile);
    const second = await deriveBrowserKey("test password", testKdfProfile);
    const otherPassword = await deriveBrowserKey("other password", testKdfProfile);
    expect(first).toEqual(second);
    expect(first).toHaveLength(32);
    expect(first).not.toEqual(otherPassword);
  });

  it("uses an independent random server salt and deployment pepper", async () => {
    const pepper = new TextEncoder().encode("deployment-pepper-test");
    const first = await hashServerPassword("test password", pepper, testServerProfile);
    const second = await hashServerPassword("test password", pepper, testServerProfile);
    expect(first).toMatch(/^\$argon2id\$/);
    expect(second).not.toBe(first);
    await expect(verifyServerPassword("test password", pepper, first)).resolves.toBe(true);
    await expect(verifyServerPassword("wrong password", pepper, first)).resolves.toBe(false);
    await expect(
      verifyServerPassword("test password", new TextEncoder().encode("other-pepper-1234"), first),
    ).resolves.toBe(false);
  });
});
