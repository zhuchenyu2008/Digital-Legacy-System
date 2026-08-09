import { afterEach, describe, expect, test, vi } from "vitest";
import { apiRequest, browserCsrfToken, setBrowserCsrfToken } from "./browser-client";

describe("browser API requests", () => {
  afterEach(() => {
    setBrowserCsrfToken(undefined);
    vi.unstubAllGlobals();
  });

  test("attaches the in-memory CSRF token to authenticated mutations", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: { ok: true } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    setBrowserCsrfToken("csrf-memory-only");

    await apiRequest("/contact/workflows/workflow-1/confirm-alive", {
      method: "POST",
      body: JSON.stringify({ password: "secret", confirmationText: "exact" }),
    });

    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(new Headers(init?.headers).get("x-csrf-token")).toBe("csrf-memory-only");
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain("secret");
  });

  test("recovers the role-specific CSRF token from a strict cookie after a page reload", async () => {
    expect(
      browserCsrfToken(
        "dls-owner-csrf=owner-cookie-token; dls-contact-csrf=contact-cookie-token",
        "/admin/settings",
      ),
    ).toBe("owner-cookie-token");
    expect(
      browserCsrfToken(
        "dls-owner-csrf=owner-cookie-token; dls-contact-csrf=contact-cookie-token",
        "/contact/workflows/current",
      ),
    ).toBe("contact-cookie-token");

    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: { ok: true } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("document", { cookie: "dls-owner-csrf=csrf-from-cookie" });
    vi.stubGlobal("location", { pathname: "/admin" });

    await apiRequest("/owner/check-ins", { method: "POST", body: "{}" });

    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(new Headers(init?.headers).get("x-csrf-token")).toBe("csrf-from-cookie");
  });
});
