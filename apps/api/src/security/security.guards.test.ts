import { GUARDS_METADATA } from "@nestjs/common/constants";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ContactPasswordController } from "../contacts/contact-auth.controller.js";
import { CsrfGuard } from "./csrf.guard.js";
import { OriginGuard } from "./origin.guard.js";
import { ContactRateLimitGuard, RateLimiter } from "./rate-limit.guard.js";
import { readRequestContext } from "./request-context.js";
import { ContactSessionGuard, readSessionToken } from "./session.guard.js";

describe("HTTP security boundaries", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("accepts only the exact configured Origin for unsafe methods", () => {
    const guard = new OriginGuard(["https://legacy.example"]);
    expect(() =>
      guard.assert({
        method: "POST",
        origin: "https://legacy.example",
        fetchSite: "same-origin",
      }),
    ).not.toThrow();
    expect(() => guard.assert({ method: "POST", origin: "https://legacy.example.evil" })).toThrow(
      /origin/i,
    );
    expect(() => guard.assert({ method: "GET" })).not.toThrow();
  });

  it("falls back to the configured public origin when optional DI is unavailable", () => {
    vi.stubEnv("PUBLIC_BASE_URL", "http://localhost:18081");
    const guard = new OriginGuard();

    expect(() =>
      guard.assert({
        method: "POST",
        origin: "http://localhost:18081",
        fetchSite: "same-origin",
      }),
    ).not.toThrow();
    expect(() => guard.assert({ method: "POST", origin: "http://localhost:18082" })).toThrow(
      /origin/i,
    );
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

  it("reads only the session cookie name allowed by the transport mode", () => {
    const request = {
      headers: { cookie: "dls-owner=local-token; __Host-dls-owner=secure-token" },
    };

    expect(readSessionToken(request, "OWNER", false)).toBe("local-token");
    expect(readSessionToken(request, "OWNER", true)).toBe("secure-token");
  });

  it("requires a contact session and CSRF token before rotating a contact password", () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, ContactPasswordController.prototype.complete),
    ).toEqual([ContactRateLimitGuard, ContactSessionGuard, CsrfGuard]);
  });
});
