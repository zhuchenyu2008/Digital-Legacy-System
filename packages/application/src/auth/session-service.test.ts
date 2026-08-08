import { describe, expect, it } from "vitest";

import { InMemorySessionStore, type SessionClock, SessionService } from "./session-service.js";

const clock: SessionClock = {
  now: () => "2026-08-08T14:00:00.000Z",
};

function service() {
  return new SessionService(new InMemorySessionStore(), {
    pepper: new TextEncoder().encode("0123456789abcdef0123456789abcdef"),
    clock,
    ownerIdleMs: 30 * 60 * 1000,
    contactIdleMs: 60 * 60 * 1000,
    absoluteMs: 24 * 60 * 60 * 1000,
    maxOwnerSessions: 2,
    maxContactSessions: 2,
  });
}

describe("SessionService", () => {
  it("issues opaque owner credentials and authenticates the matching role", async () => {
    const sessions = service();
    const issued = await sessions.create({
      actorType: "OWNER",
      actorId: "00000000-0000-0000-0000-000000000001",
      credentialVersion: 3,
    });

    expect(issued.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(issued.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(issued.token).not.toContain("00000000");
    await expect(
      sessions.authenticate(issued.token, { actorType: "CONTACT" }),
    ).rejects.toMatchObject({ code: "SESSION_INVALID" });
    await expect(
      sessions.authenticate(issued.token, { actorType: "OWNER" }),
    ).resolves.toMatchObject({
      actorId: "00000000-0000-0000-0000-000000000001",
    });
  });

  it("rotates sessions and revokes expired or replaced credentials", async () => {
    const sessions = service();
    const first = await sessions.create({
      actorType: "OWNER",
      actorId: "00000000-0000-0000-0000-000000000001",
      credentialVersion: 1,
    });
    const second = await sessions.rotate(first.token, {
      actorType: "OWNER",
      actorId: "00000000-0000-0000-0000-000000000001",
      credentialVersion: 2,
    });

    await expect(sessions.authenticate(first.token, { actorType: "OWNER" })).rejects.toMatchObject({
      code: "SESSION_INVALID",
    });
    await expect(
      sessions.authenticate(second.token, { actorType: "OWNER", credentialVersion: 1 }),
    ).rejects.toMatchObject({ code: "SESSION_INVALID" });
    await expect(
      sessions.authenticate(second.token, { actorType: "OWNER", credentialVersion: 2 }),
    ).resolves.toBeDefined();
  });

  it("caps concurrent sessions and verifies synchronizer CSRF tokens", async () => {
    const sessions = service();
    const input = {
      actorType: "OWNER" as const,
      actorId: "00000000-0000-0000-0000-000000000001",
      credentialVersion: 1,
    };
    const first = await sessions.create(input);
    const second = await sessions.create(input);
    const third = await sessions.create(input);

    await expect(sessions.authenticate(first.token, { actorType: "OWNER" })).rejects.toMatchObject({
      code: "SESSION_INVALID",
    });
    await expect(sessions.verifyCsrf(third.token, third.csrfToken)).resolves.toBeUndefined();
    await expect(sessions.verifyCsrf(third.token, "wrong")).rejects.toMatchObject({
      code: "CSRF_INVALID",
    });
    await expect(
      sessions.authenticate(second.token, { actorType: "OWNER" }),
    ).resolves.toBeDefined();
  });
});
