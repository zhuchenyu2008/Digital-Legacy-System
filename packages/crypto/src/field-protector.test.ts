import { randomBytes } from "node:crypto";
import { parseFieldKeyring } from "@dls/contracts";
import { describe, expect, it } from "vitest";
import { AesFieldProtector } from "./field-protector.js";
import { AesNotificationCipher } from "./notifications/aes-notification-cipher.js";

function keyring(activeVersion: number, keys: Record<number, Uint8Array>) {
  const lookupKeys = Object.fromEntries(
    Object.keys(keys).map((version) => [version, randomBytes(32).toString("base64")]),
  );
  return parseFieldKeyring(
    JSON.stringify({
      version: 1,
      activeVersion,
      lookupKey: lookupKeys[String(activeVersion)],
      lookupKeys,
      keys: Object.fromEntries(
        Object.entries(keys).map(([version, value]) => [
          version,
          Buffer.from(value).toString("base64"),
        ]),
      ),
    }),
  );
}

describe("versioned field protector", () => {
  it("writes with the active version and decrypts retained historical versions", async () => {
    const firstKey = randomBytes(32);
    const secondKey = randomBytes(32);
    const oldProtector = new AesFieldProtector(keyring(1, { 1: firstKey }));
    const rotatedProtector = new AesFieldProtector(keyring(2, { 1: firstKey, 2: secondKey }));
    const oldEnvelope = await oldProtector.protect("legacy", "owner-display-name");
    const newEnvelope = await rotatedProtector.protect("current", "owner-display-name");

    expect(oldEnvelope.keyVersion).toBe(1);
    expect(newEnvelope.keyVersion).toBe(2);
    await expect(rotatedProtector.unprotect(oldEnvelope, "owner-display-name")).resolves.toBe(
      "legacy",
    );
    await expect(rotatedProtector.unprotect(newEnvelope, "owner-display-name")).resolves.toBe(
      "current",
    );
  });

  it("retains lookup HMAC candidates across key rotation and legacy fallback", async () => {
    const firstKey = randomBytes(32);
    const secondKey = randomBytes(32);
    const oldKeyring = keyring(1, { 1: firstKey });
    const rotatedKeyring = parseFieldKeyring(
      (() => {
        const activeLookupKey = Buffer.from(randomBytes(32)).toString("base64");
        return JSON.stringify({
          version: 1,
          activeVersion: 2,
          lookupKey: activeLookupKey,
          lookupKeys: {
            1: Buffer.from(oldKeyring.lookupKey).toString("base64"),
            2: activeLookupKey,
          },
          keys: {
            1: Buffer.from(firstKey).toString("base64"),
            2: Buffer.from(secondKey).toString("base64"),
          },
        });
      })(),
    );
    const protector = new AesFieldProtector(rotatedKeyring, new Uint8Array(32).fill(9));
    const candidates = await protector.lookupCandidates("legacy@example.com");
    expect(candidates).toHaveLength(3);
  });

  it("derives notification encryption from field keys rather than lookup keys", async () => {
    const encryptionKey = randomBytes(32);
    const rotatedEncryptionKey = randomBytes(32);
    const oldLookupKey = randomBytes(32);
    const rotatedLookupKey = randomBytes(32);
    const oldKeyring = parseFieldKeyring(
      JSON.stringify({
        version: 1,
        activeVersion: 1,
        lookupKey: oldLookupKey.toString("base64"),
        lookupKeys: { 1: oldLookupKey.toString("base64") },
        keys: { 1: encryptionKey.toString("base64") },
      }),
    );
    const rotatedKeyring = parseFieldKeyring(
      JSON.stringify({
        version: 1,
        activeVersion: 2,
        lookupKey: rotatedLookupKey.toString("base64"),
        lookupKeys: {
          1: rotatedLookupKey.toString("base64"),
          2: rotatedLookupKey.toString("base64"),
        },
        keys: {
          1: encryptionKey.toString("base64"),
          2: rotatedEncryptionKey.toString("base64"),
        },
      }),
    );
    const oldCipher = new AesNotificationCipher(oldKeyring);
    const rotatedCipher = new AesNotificationCipher(rotatedKeyring);
    const encrypted = await oldCipher.encrypt("historical notification", "notification:subject");
    await expect(
      rotatedCipher.decrypt(encrypted.ciphertext, encrypted.nonce, "notification:subject"),
    ).resolves.toBe("historical notification");
  });
});
