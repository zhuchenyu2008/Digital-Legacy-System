import { afterEach, describe, expect, test, vi } from "vitest";
import { apiRequest, setBrowserCsrfToken } from "./browser-client";

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
});
