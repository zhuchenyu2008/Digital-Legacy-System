import { afterEach, describe, expect, test, vi } from "vitest";
import { POST } from "./route";

describe("web API proxy", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("forwards authenticated mutation bodies and security headers without moving secrets into the URL", async () => {
    const upstream = vi.fn(async (request: Request) => {
      expect(request.url).toBe("http://api.test/contact/workflows/workflow-1/confirm-alive");
      expect(request.headers.get("cookie")).toBe("__Host-dls-contact=session");
      expect(request.headers.get("x-csrf-token")).toBe("csrf-token");
      expect(await request.json()).toEqual({ password: "secret", confirmationText: "exact" });
      return new Response(JSON.stringify({ data: { cancelled: true } }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-request-id": "request-1",
          "set-cookie": "__Host-dls-contact=rotated; Path=/; HttpOnly; SameSite=Strict",
        },
      });
    });
    vi.stubGlobal("fetch", upstream);

    const response = await POST(
      new Request("http://web.test/api/contact/workflows/workflow-1/confirm-alive", {
        method: "POST",
        headers: {
          cookie: "__Host-dls-contact=session",
          "content-type": "application/json",
          "x-csrf-token": "csrf-token",
        },
        body: JSON.stringify({ password: "secret", confirmationText: "exact" }),
      }),
      {
        params: Promise.resolve({ path: ["contact", "workflows", "workflow-1", "confirm-alive"] }),
      },
      "http://api.test",
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("request-1");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(upstream).toHaveBeenCalledOnce();
  });
});
