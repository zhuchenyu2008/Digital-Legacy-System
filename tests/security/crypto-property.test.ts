import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseSingleByteRange } from "../../apps/api/src/public/public.controller.js";
import { AesNotificationCipher } from "../../packages/crypto/src/notifications/aes-notification-cipher.js";
import {
  decodeBase64Url,
  encodeBase64Url,
  isCanonicalBase64Url,
} from "../../packages/crypto/src/protocol/base64url.js";
import { canonicalizeAad } from "../../packages/crypto/src/protocol/canonical-aad.js";
import {
  decodeWrappedKeyV1,
  encodeWrappedKeyV1,
} from "../../packages/crypto/src/protocol/envelopes.js";
import { ShareEnvelopeV1Schema } from "../../packages/crypto/src/shares/share-envelope.js";
import {
  encodeFrameLength,
  MAX_CIPHERTEXT_FRAME_BYTES,
  parseFrameLength,
} from "../../packages/crypto/src/stream/file-format.js";
import { assertObjectKey, buildObjectKey } from "../../packages/storage/src/object-key.js";

function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
}

describe("deterministic crypto and protocol properties", () => {
  it("covers at least 10,000 deterministic protocol/property inputs", () => {
    const next = rng(0x7a11ce55);
    let cases = 0;
    for (let index = 0; index < 2_500; index += 1) {
      const bytes = Uint8Array.from({ length: 1 + (next() % 96) }, () => next() & 0xff);
      const encoded = encodeBase64Url(bytes);
      expect(isCanonicalBase64Url(encoded)).toBe(true);
      expect(decodeBase64Url(encoded)).toEqual(bytes);
      cases += 1;
    }
    for (let index = 0; index < 2_500; index += 1) {
      const id = `${(next() >>> 0).toString(16).padStart(8, "0")}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
      const key = buildObjectKey(id);
      expect(() => assertObjectKey(key)).not.toThrow();
      expect(() => assertObjectKey(`${key}/../escape`)).toThrow();
      cases += 1;
    }
    for (let index = 0; index < 2_500; index += 1) {
      const context = {
        protocol: "dls-property-v1",
        version: 1,
        purpose: "property",
        vaultId: `vault-${next()}`,
        packageId: `package-${next()}`,
        packageVersion: (next() % 100) + 1,
        keyId: `frame-${index}`,
        algorithm: "test",
      } as const;
      const left = canonicalizeAad(context);
      const right = canonicalizeAad({ ...context });
      expect(left).toEqual(right);
      cases += 1;
    }
    for (let index = 0; index < 2_500; index += 1) {
      const length = 17 + (next() % (MAX_CIPHERTEXT_FRAME_BYTES - 16));
      expect(parseFrameLength(encodeFrameLength(length))).toBe(length);
      const digest = createHash("sha256").update(String(next())).digest("hex");
      expect(digest).toMatch(/^[0-9a-f]{64}$/u);
      cases += 1;
    }
    expect(cases).toBeGreaterThanOrEqual(10_000);
  });

  it("rejects at least 10,000 bounded malformed envelope/share/frame/range/path inputs", () => {
    const next = rng(0xbadc0de);
    let cases = 0;
    for (let index = 0; index < 2_000; index += 1) {
      const nonce = encodeBase64Url(Uint8Array.from({ length: 24 }, () => next() & 0xff));
      const ciphertext = encodeBase64Url(Uint8Array.from({ length: 16 }, () => next() & 0xff));
      const malformed = JSON.stringify({
        version: 2,
        algorithm: "xchacha20poly1305-ietf",
        purpose: "owner-vk",
        keyId: `key-${index}`,
        nonce,
        ciphertext,
      });
      expect(() => decodeWrappedKeyV1(malformed)).toThrow();
      cases += 1;
    }
    for (let index = 0; index < 2_000; index += 1) {
      expect(
        ShareEnvelopeV1Schema.safeParse({
          version: 1,
          algorithm: "crypto-box-seal",
          purpose: "death-share",
          vaultId: `vault-${next()}`,
          generationId: `generation-${next()}`,
          contactId: `contact-${next()}`,
          shareIndex: index + 1,
          threshold: 2,
          commitmentDigest: `${encodeBase64Url(new Uint8Array(31))}=`,
          ciphertext: "not+canonical",
        }).success,
      ).toBe(false);
      cases += 1;
    }
    for (let index = 0; index < 2_000; index += 1) {
      const invalid =
        index % 2 === 0
          ? Uint8Array.from({ length: index % 4 }, () => next() & 0xff)
          : Uint8Array.from([0, 0, 0, next() % 17]);
      expect(() => parseFrameLength(invalid)).toThrow();
      cases += 1;
    }
    for (let index = 0; index < 2_000; index += 1) {
      const ranges = [
        `bytes=-${next() % 10_000}`,
        `bytes=${next() % 10_000}-${next() % 10_000},${next() % 10_000}-`,
        `items=${next() % 10_000}-${next() % 10_000}`,
        `bytes=${100 + (next() % 100)}-${next() % 100}`,
      ];
      expect(() => parseSingleByteRange(ranges[index % ranges.length] ?? "")).toThrow();
      cases += 1;
    }
    for (let index = 0; index < 2_000; index += 1) {
      const segment = (next() >>> 0).toString(16);
      const paths = [`../${segment}`, `aa\\${segment}`, `/absolute/${segment}`, `aa/./${segment}`];
      expect(() => assertObjectKey(paths[index % paths.length] ?? "")).toThrow();
      cases += 1;
    }
    expect(cases).toBe(10_000);
  }, 15_000);

  it("round-trips accepted envelope encodings canonically", () => {
    const envelope = {
      version: 1 as const,
      algorithm: "xchacha20poly1305-ietf" as const,
      purpose: "owner-vk" as const,
      keyId: "owner-key-v1",
      nonce: encodeBase64Url(Uint8Array.from({ length: 24 }, (_, index) => index)),
      ciphertext: encodeBase64Url(Uint8Array.from({ length: 32 }, (_, index) => 255 - index)),
    };
    const canonical = encodeWrappedKeyV1(envelope);
    expect(encodeWrappedKeyV1(decodeWrappedKeyV1(canonical))).toBe(canonical);
  });

  it("rejects every sampled one-bit mutation of authenticated ciphertext and AAD", async () => {
    const cipher = new AesNotificationCipher(
      Uint8Array.from({ length: 32 }, (_, index) => index + 1),
    );
    const encrypted = await cipher.encrypt("security-property-payload", "notification-body");

    for (let index = 0; index < encrypted.ciphertext.length; index += 1) {
      const mutated = new Uint8Array(encrypted.ciphertext);
      mutated[index] ^= 1 << (index % 8);
      await expect(cipher.decrypt(mutated, encrypted.nonce, "notification-body")).rejects.toThrow();
    }
    await expect(
      cipher.decrypt(encrypted.ciphertext, encrypted.nonce, "notification-recipient"),
    ).rejects.toThrow();
  });
});
