import { describe, expect, it } from "vitest";
import { OriginGuard } from "../../apps/api/src/security/origin.guard.js";
import { RateLimiter } from "../../apps/api/src/security/rate-limit.guard.js";
import { readRequestContext } from "../../apps/api/src/security/request-context.js";

describe("HTTP security contract", () => {
  it("requires exact origin matching for unsafe methods", () => {
    const guard = new OriginGuard(["https://legacy.example"]);
    expect(() => guard.assert({ method: "POST", origin: "https://legacy.example" })).not.toThrow();
    expect(() => guard.assert({ method: "POST", origin: "https://legacy.example.evil" })).toThrow();
  });

  it("returns bounded retry information when a bucket is exhausted", () => {
    const limiter = new RateLimiter({ windowMs: 60_000, maxAttempts: 1 });
    expect(limiter.consume("upload:127.0.0.1").allowed).toBe(true);
    expect(limiter.consume("upload:127.0.0.1").retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it("preserves a valid request id and rejects malformed ids", () => {
    const requestId = "018f28a8-7f9a-7b32-9e41-4454f1c75691";
    expect(
      readRequestContext({ headers: { "x-request-id": requestId }, ip: "127.0.0.1" }).requestId,
    ).toBe(requestId);
    expect(() =>
      readRequestContext({ headers: { "x-request-id": "bad" }, ip: "127.0.0.1" }),
    ).toThrow();
  });
});
