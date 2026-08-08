import { describe, expect, it } from "vitest";
import { redactLogValue } from "../../packages/contracts/src/logging/redaction.js";

describe("structured log redaction", () => {
  it("removes authentication, CSRF, key, share, and plaintext payload fields", () => {
    const result = redactLogValue({
      password: "password-value",
      authorization: "Bearer secret-value",
      csrfToken: "csrf-value",
      privateKey: "private-key-value",
      recoveryShare: "share-value",
      ciphertext: "ciphertext-value",
      nested: { body: "safe", token: "token-value" },
    }) as Record<string, unknown>;

    expect(JSON.stringify(result)).not.toMatch(
      /password-value|secret-value|csrf-value|private-key-value|share-value|ciphertext-value|token-value/,
    );
    expect(result.nested).toEqual({ body: "safe", token: "[REDACTED]" });
  });
});
