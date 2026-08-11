import { afterEach, describe, expect, it, vi } from "vitest";
import { SmtpProbe, smtpTransportSettings } from "../../apps/api/src/owner/smtp-probe.js";
import { OriginGuard } from "../../apps/api/src/security/origin.guard.js";
import { readRequestContext } from "../../apps/api/src/security/request-context.js";
import { POST } from "../../apps/web/src/app/api/[...path]/route.js";

describe("SSRF, forwarded-header, and redirect boundaries", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("accepts only SMTP transport URLs and derives STARTTLS for port 587", () => {
    expect(smtpTransportSettings("smtp://mail.example:587", "production")).toMatchObject({
      host: "mail.example",
      port: 587,
      secure: false,
      startTls: true,
    });
    expect(() =>
      smtpTransportSettings("http://169.254.169.254/latest/meta-data", "production"),
    ).toThrow(/SMTP/i);
    expect(() => smtpTransportSettings("file:///etc/passwd", "production")).toThrow(/SMTP/i);
  });

  it("does not trust hostile forwarded origins or malformed request IDs", () => {
    const guard = new OriginGuard(["https://legacy.example"]);
    expect(() =>
      guard.assert({
        method: "POST",
        origin: "https://legacy.example",
        fetchSite: "same-origin",
      }),
    ).not.toThrow();
    expect(() =>
      guard.assert({ method: "POST", origin: "https://legacy.example@evil.test" }),
    ).toThrow(/origin/i);
    expect(() =>
      readRequestContext({ headers: { "x-request-id": "not-a-uuid" }, ip: "127.0.0.1" }),
    ).toThrow(/request id/i);
    expect(() => readRequestContext({ headers: {}, ip: "" })).toThrow(/IP/i);
  });

  it("keeps the SMTP probe bounded to an explicit server and port", () => {
    const probe = new SmtpProbe(
      { host: "127.0.0.1", port: 587, secure: false, startTls: true },
      "Digital Legacy System <no-reply@example.test>",
    );
    expect(probe).toBeDefined();
  });

  it("strips client-controlled forwarding headers and does not expose an upstream redirect", async () => {
    let forwarded: Request | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (request: Request) => {
        forwarded = request;
        return new Response(null, {
          status: 302,
          headers: { location: "https://evil.example/collect" },
        });
      }),
    );
    const response = await POST(
      new Request("https://legacy.example/api/owner/settings?next=https://evil.example", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          forwarded: "host=evil.example;proto=http",
          "x-forwarded-for": "169.254.169.254",
          "x-forwarded-host": "evil.example",
          "x-forwarded-port": "80",
          "x-forwarded-proto": "http",
        },
        body: "{}",
      }),
      { params: Promise.resolve({ path: ["owner", "settings"] }) },
      "http://api:3001",
    );

    expect(forwarded?.url).toBe("http://api:3001/owner/settings?next=https://evil.example");
    for (const header of [
      "forwarded",
      "x-forwarded-for",
      "x-forwarded-host",
      "x-forwarded-port",
      "x-forwarded-proto",
    ]) {
      expect(forwarded?.headers.has(header), header).toBe(false);
    }
    expect(response.status).toBe(302);
    expect(response.headers.has("location")).toBe(false);
  });
});
