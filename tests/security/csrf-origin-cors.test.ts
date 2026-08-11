import "../../apps/api/node_modules/reflect-metadata/Reflect.js";

import { describe, expect, it, vi } from "vitest";
import { Controller, Module, Post } from "../../apps/api/node_modules/@nestjs/common/index.js";
import { NestFactory } from "../../apps/api/node_modules/@nestjs/core/index.js";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "../../apps/api/node_modules/@nestjs/platform-fastify/index.js";
import { getApiRuntimeConfig } from "../../apps/api/src/config/api-runtime-config.js";
import { CsrfGuard } from "../../apps/api/src/security/csrf.guard.js";
import { OriginGuard } from "../../apps/api/src/security/origin.guard.js";
import { SecurityModule } from "../../apps/api/src/security/security.module.js";

class OriginProbeController {
  public create() {
    return { ok: true };
  }
}
Controller("origin-probe")(OriginProbeController);
const originProbeDescriptor = Object.getOwnPropertyDescriptor(
  OriginProbeController.prototype,
  "create",
);
if (originProbeDescriptor === undefined) throw new Error("origin probe descriptor is unavailable");
Post()(OriginProbeController.prototype, "create", originProbeDescriptor);

class OriginProbeModule {}
Module({ imports: [SecurityModule], controllers: [OriginProbeController] })(OriginProbeModule);

describe("CSRF, Origin, and CORS boundaries", () => {
  it("allows only the configured public origin in production", () => {
    const production = {
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://dls_api:secret@postgres:5432/dls",
      PUBLIC_BASE_URL: "https://legacy.example",
      SETUP_TOKEN: "s".repeat(32),
      SESSION_SECRET: Buffer.alloc(32, 1).toString("base64"),
      SESSION_PEPPER: Buffer.alloc(32, 2).toString("base64"),
      TOKEN_PEPPER: Buffer.alloc(32, 3).toString("base64"),
      MAIL_TRANSPORT_URL: "smtps://smtp.example:465",
      MAIL_FROM: "Digital Legacy <no-reply@legacy.example>",
      CONTACT_CONSENT_VERSION: "2026-08-11",
      CONTACT_CONSENT_SHA256: "a".repeat(64),
    };
    expect(getApiRuntimeConfig(production).allowedOrigins).toEqual(["https://legacy.example"]);
    expect(
      getApiRuntimeConfig({
        NODE_ENV: "development",
        PUBLIC_BASE_URL: "http://localhost:4173",
      }).allowedOrigins,
    ).toEqual(["http://localhost:4173", "http://localhost:3000"]);

    for (const variable of [
      "DATABASE_URL",
      "PUBLIC_BASE_URL",
      "SETUP_TOKEN",
      "SESSION_SECRET",
      "SESSION_PEPPER",
      "TOKEN_PEPPER",
      "MAIL_TRANSPORT_URL",
      "MAIL_FROM",
      "CONTACT_CONSENT_VERSION",
      "CONTACT_CONSENT_SHA256",
    ]) {
      expect(() => getApiRuntimeConfig({ ...production, [variable]: undefined })).toThrow(variable);
    }
    for (const variable of ["SESSION_SECRET", "SESSION_PEPPER", "TOKEN_PEPPER"]) {
      expect(() => getApiRuntimeConfig({ ...production, [variable]: "d2Vhaw==" })).toThrow(
        variable,
      );
    }
    expect(() => getApiRuntimeConfig({ ...production, SETUP_TOKEN: "short" })).toThrow(
      "SETUP_TOKEN",
    );
    expect(() =>
      getApiRuntimeConfig({ ...production, CONTACT_CONSENT_SHA256: "not-a-digest" }),
    ).toThrow("CONTACT_CONSENT_SHA256");
  });

  it("requires exact Origin matches for unsafe methods", () => {
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
    expect(() =>
      guard.assert({
        method: "OPTIONS",
        origin: "https://legacy.example",
        fetchSite: "same-origin",
      }),
    ).not.toThrow();
    expect(() => guard.assert({ method: "OPTIONS", origin: "https://evil.example" })).toThrow(
      /origin/i,
    );
    expect(() => guard.assert({ method: "POST" })).toThrow(/origin/i);
    expect(() => guard.assert({ method: "POST", origin: "https://legacy.example" })).toThrow(
      /fetch-site/i,
    );
  });

  it("rejects cross-site unsafe requests even when an allowed Origin is supplied", () => {
    const guard = new OriginGuard(["https://legacy.example"]);

    expect(() =>
      guard.assert({
        method: "POST",
        origin: "https://legacy.example",
        fetchSite: "same-site",
      }),
    ).toThrow(/fetch-site/i);
    expect(() =>
      guard.assert({
        method: "POST",
        origin: "https://legacy.example",
        fetchSite: "same-origin",
      }),
    ).not.toThrow();
  });

  it("applies the boundary globally to every unsafe HTTP route", async () => {
    const app = await NestFactory.create<NestFastifyApplication>(
      OriginProbeModule,
      new FastifyAdapter(),
      { logger: false },
    );
    await app.init();
    try {
      const server = app.getHttpAdapter().getInstance();
      const blocked = await server.inject({
        method: "POST",
        url: "/origin-probe",
        headers: {
          origin: "http://localhost:3000",
          "sec-fetch-site": "cross-site",
        },
      });
      expect(blocked.statusCode).toBe(403);

      const allowed = await server.inject({
        method: "POST",
        url: "/origin-probe",
        headers: {
          origin: "http://localhost:3000",
          "sec-fetch-site": "same-origin",
        },
      });
      expect(allowed.statusCode).toBe(201);

      const simpleForm = await server.inject({
        method: "POST",
        url: "/origin-probe",
        headers: {
          origin: "http://localhost:3000",
          "sec-fetch-site": "same-origin",
          "content-type": "application/x-www-form-urlencoded",
        },
        payload: "action=publish",
      });
      expect(simpleForm.statusCode).toBe(415);

      const preflight = await server.inject({
        method: "OPTIONS",
        url: "/origin-probe",
        headers: {
          origin: "https://evil.example",
          "access-control-request-method": "POST",
        },
      });
      expect(preflight.statusCode).toBeGreaterThanOrEqual(400);
      expect(preflight.headers["access-control-allow-origin"]).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it("verifies the role-specific CSRF token and rejects missing or mismatched headers", async () => {
    const verifyCsrf = vi.fn().mockResolvedValue(undefined);
    const guard = new CsrfGuard({ verifyCsrf } as never);
    const request = {
      method: "POST",
      sessionToken: "owner-session",
      sessionActorType: "OWNER" as const,
      headers: { "x-csrf-token": "csrf-1" },
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as never;
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(verifyCsrf).toHaveBeenCalledWith("owner-session", "csrf-1");

    const missing = { ...request, headers: {} };
    await expect(
      guard.canActivate({ switchToHttp: () => ({ getRequest: () => missing }) } as never),
    ).rejects.toThrow(/CSRF/i);
    verifyCsrf.mockRejectedValueOnce(new Error("mismatch"));
    await expect(guard.canActivate(context)).rejects.toThrow(/CSRF/i);
  });
});
