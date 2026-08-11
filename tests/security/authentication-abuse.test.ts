import { describe, expect, it } from "vitest";
import { RateLimiter } from "../../apps/api/src/security/rate-limit.guard.js";
import { readSessionToken } from "../../apps/api/src/security/session.guard.js";
import {
  clearedSessionCookieHeaders,
  sessionCookieHeaders,
} from "../../apps/api/src/security/session-cookies.js";
import {
  InMemorySessionStore,
  SessionService,
} from "../../packages/application/src/auth/session-service.js";

describe("authentication abuse boundaries", () => {
  it("bounds password and token attempts and exposes a retry window", () => {
    const limiter = new RateLimiter({ windowMs: 60_000, maxAttempts: 3 });
    expect(limiter.consume("owner:127.0.0.1", 1_000).allowed).toBe(true);
    expect(limiter.consume("owner:127.0.0.1", 1_001).allowed).toBe(true);
    expect(limiter.consume("owner:127.0.0.1", 1_002).allowed).toBe(true);
    const blocked = limiter.consume("owner:127.0.0.1", 1_003);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(1);
    expect(limiter.consume("owner:127.0.0.1", 61_001).allowed).toBe(true);
  });

  it("does not let an owner cookie authenticate as a contact or vice versa", () => {
    const request = {
      headers: {
        cookie: "dls-owner=owner-token; dls-contact=contact-token; __Host-dls-owner=secure-owner",
      },
    };
    expect(readSessionToken(request, "OWNER", false)).toBe("owner-token");
    expect(readSessionToken(request, "CONTACT", false)).toBe("contact-token");
    expect(readSessionToken(request, "OWNER", true)).toBe("secure-owner");
  });

  it("expires both role cookies without echoing token material", () => {
    const issued = sessionCookieHeaders("OWNER", "session-secret", "csrf-secret", false);
    const cleared = clearedSessionCookieHeaders("OWNER", false);
    expect(issued.join("\n")).toContain("HttpOnly");
    expect(cleared.every((value) => value.includes("Max-Age=0"))).toBe(true);
    expect(cleared.join("\n")).not.toContain("session-secret");
    expect(cleared.join("\n")).not.toContain("csrf-secret");
  });

  it("rotates opaque sessions and rejects replay and expiry", async () => {
    let now = "2026-08-11T00:00:00.000Z";
    const service = new SessionService(new InMemorySessionStore(), {
      pepper: new Uint8Array(32).fill(7),
      clock: { now: () => now },
      ownerIdleMs: 1_000,
      absoluteMs: 10_000,
    });
    const issued = await service.create({
      actorType: "OWNER",
      actorId: "owner-1",
      credentialVersion: 1,
    });
    expect(issued.token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(issued.token).not.toBe("attacker-supplied-session");

    const rotated = await service.rotate(issued.token, {
      actorType: "OWNER",
      actorId: "owner-1",
      credentialVersion: 1,
    });
    expect(rotated.token).not.toBe(issued.token);
    await expect(service.authenticate(issued.token, { actorType: "OWNER" })).rejects.toMatchObject({
      code: "SESSION_INVALID",
    });
    await expect(
      service.authenticate(rotated.token, { actorType: "OWNER" }),
    ).resolves.toMatchObject({ actorId: "owner-1" });

    now = "2026-08-11T00:00:01.000Z";
    await expect(service.authenticate(rotated.token, { actorType: "OWNER" })).rejects.toMatchObject(
      { code: "SESSION_INVALID" },
    );
  });
});
