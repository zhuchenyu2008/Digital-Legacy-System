import { describe, expect, test, vi } from "vitest";
import { createDlsHttpClient as createFromPublicClient } from "../client.js";
import { createDlsHttpClient } from "./http-client.js";

describe("generated HTTP client", () => {
  test("is exported from the public client entry point", () => {
    expect(createFromPublicClient).toBe(createDlsHttpClient);
  });

  test("uses the injected base URL, fetch, CSRF token, and request ID", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      Promise.resolve(new Response(null, { status: 200 })),
    );
    const client = createDlsHttpClient({
      baseUrl: "https://dls.example.test/api",
      fetch: fetchImplementation,
      csrfTokenProvider: () => "csrf-token",
      requestIdProvider: () => "request-id",
    });

    await client.GET("/health/live");

    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    const request = fetchImplementation.mock.calls[0]?.[0];
    expect(request).toBeInstanceOf(Request);
    expect((request as Request).url).toBe("https://dls.example.test/api/health/live");
    expect((request as Request).headers.get("x-csrf-token")).toBe("csrf-token");
    expect((request as Request).headers.get("x-request-id")).toBe("request-id");
  });

  test("does not retry a failed non-idempotent request", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () => {
      throw new TypeError("network unavailable");
    });
    const client = createDlsHttpClient({
      baseUrl: "https://dls.example.test",
      fetch: fetchImplementation,
    }) as unknown as {
      POST(path: string): Promise<unknown>;
    };

    await expect(client.POST("/health/live")).rejects.toThrow("network unavailable");
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });
});
