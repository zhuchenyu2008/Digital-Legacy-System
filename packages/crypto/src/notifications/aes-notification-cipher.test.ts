import { describe, expect, it } from "vitest";
import { AesNotificationCipher } from "./aes-notification-cipher.js";

describe("notification encryption", () => {
  it("round-trips only with the matching root and purpose", async () => {
    const cipher = new AesNotificationCipher(new Uint8Array(32).fill(23));
    const encrypted = await cipher.encrypt("private notification", "notification:template-data");

    await expect(
      cipher.decrypt(encrypted.ciphertext, encrypted.nonce, "notification:template-data"),
    ).resolves.toBe("private notification");
    await expect(
      cipher.decrypt(encrypted.ciphertext, encrypted.nonce, "notification:subject"),
    ).rejects.toThrow();
  });
});
