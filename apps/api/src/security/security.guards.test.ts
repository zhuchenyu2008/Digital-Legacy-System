import { describe, expect, it } from "vitest";

import { OriginGuard } from "./origin.guard.js";
import { RateLimiter } from "./rate-limit.guard.js";
import { readRequestContext } from "./request-context.js";

describe("HTTP security boundaries", () => {
  it("accepts only the exact configured Origin for unsafe methods", () => {
    const guard = new OriginGuard(["https://legacy.example"]);
    expect(() => guard.assert({ method: "POST", origin: "https://legacy.example" })).not.toThrow();
    expect(() => guard.assert({ method: "POST", origin: "https://legacy.example.evil" })).toThrow(
      /origin/i,
    );
    expect(() => guard.assert({ method: "GET" })).not.toThrow();
  });

  it("uses bounded atomic buckets and returns retry timing", () => {
    const limiter = new RateLimiter({ windowMs: 60_000, maxAttempts: 2 });
    expect(limiter.consume("login:one").allowed).toBe(true);
    expect(limiter.consume("login:one").allowed).toBe(true);
    const blocked = limiter.consume("login:one");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it("normalizes a valid request id and rejects malformed ids", () => {
    const valid = "018f28a8-7f9a-7b32-9e41-4454f1c75691";
    expect(
      readRequestContext({ headers: { "x-request-id": valid }, ip: "127.0.0.1" }).requestId,
    ).toBe(valid);
    expect(() =>
      readRequestContext({ headers: { "x-request-id": "not-a-uuid" }, ip: "127.0.0.1" }),
    ).toThrow(/request id/i);
  });
});
