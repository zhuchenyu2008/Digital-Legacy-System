import { describe, expect, test } from "vitest";
import { clearedSessionCookieHeaders, sessionCookieHeaders } from "./session-cookies";

describe("session cookie headers", () => {
  test("pairs an HttpOnly session cookie with a role-specific strict CSRF cookie", () => {
    const headers = sessionCookieHeaders("OWNER", "session token", "csrf token", true);

    expect(headers).toHaveLength(2);
    expect(headers[0]).toContain("__Host-dls-owner=session%20token");
    expect(headers[0]).toContain("HttpOnly");
    expect(headers[0]).toContain("SameSite=Strict");
    expect(headers[0]).toContain("Secure");
    expect(headers[1]).toContain("dls-owner-csrf=csrf%20token");
    expect(headers[1]).not.toContain("HttpOnly");
    expect(headers[1]).toContain("SameSite=Strict");
    expect(headers[1]).toContain("Secure");
  });

  test("expires both owner cookies without exposing either value", () => {
    const headers = clearedSessionCookieHeaders("OWNER", false);

    expect(headers).toHaveLength(2);
    expect(headers.every((header) => header.includes("Max-Age=0"))).toBe(true);
    expect(headers.join(";")).not.toMatch(/session token|csrf token/iu);
  });
});
