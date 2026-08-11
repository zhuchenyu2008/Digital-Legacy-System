import { describe, expect, it } from "vitest";
import { redactSecrets, scanText } from "./secret-scan.js";

describe("token and log redaction", () => {
  it("detects raw credentials and redacts them before persistence", () => {
    const raw = "request token=token-secret-123456 password=owner-password-2026";
    expect(() => scanText(raw, { source: "log", approved: [] })).toThrow(/secret/i);
    const redacted = redactSecrets(raw, ["token-secret-123456", "owner-password-2026"]);
    expect(redacted).toBe("request token=[REDACTED] password=[REDACTED]");
  });

  it("allows only explicitly approved deterministic fixture values", () => {
    expect(() =>
      scanText("owner-e2e-password-2026", {
        source: "fixture",
        approved: ["owner-e2e-password-2026"],
      }),
    ).not.toThrow();
  });

  it("does not mistake typed fields or runtime credential expressions for embedded secrets", () => {
    expect(() =>
      scanText(
        "password?: string; const settings = { password: decodeURIComponent(url.password) };",
        { source: "smtp-probe.ts", approved: [] },
      ),
    ).not.toThrow();
  });
});
