import { readFile } from "node:fs/promises";
import { SessionError } from "@dls/application";
import {
  type ArgumentsHost,
  BadRequestException,
  Controller,
  Get,
  HttpException,
  Module,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { StableErrorFilter } from "./error.filter.js";

type CapturedResponse = {
  statusCode?: number;
  body?: unknown;
};

function createHost(requestId = "request-123"): {
  host: ArgumentsHost;
  response: CapturedResponse;
} {
  const response: CapturedResponse = {};
  const reply = {
    status(code: number) {
      response.statusCode = code;
      return reply;
    },
    send(body: unknown) {
      response.body = body;
    },
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => reply,
      getRequest: () => ({ id: requestId }),
    }),
  } as ArgumentsHost;
  return { host, response };
}

describe("StableErrorFilter", () => {
  test("normalizes Nest HTTP exceptions and preserves structured details", () => {
    const { host, response } = createHost();

    new StableErrorFilter().catch(
      new HttpException(
        { code: "CONTACT_INVALID", message: "contact is invalid", details: { field: "email" } },
        422,
      ),
      host,
    );

    expect(response.statusCode).toBe(422);
    expect(response.body).toEqual({
      error: {
        code: "CONTACT_INVALID",
        message: "contact is invalid",
        requestId: "request-123",
        details: { field: "email" },
      },
    });
  });

  test("uses session error codes and status", () => {
    const { host, response } = createHost("session-request");

    new StableErrorFilter().catch(new SessionError("CSRF_INVALID", "CSRF token is invalid"), host);

    expect(response.statusCode).toBe(403);
    expect(response.body).toEqual({
      error: {
        code: "CSRF_INVALID",
        message: "CSRF token is invalid",
        requestId: "session-request",
        details: null,
      },
    });
  });

  test("converts unknown failures to a stable internal error", () => {
    const { host, response } = createHost();

    new StableErrorFilter().catch(new Error("database connection failed"), host);

    expect(response.statusCode).toBe(500);
    expect(response.body).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal server error",
        requestId: "request-123",
        details: null,
      },
    });
  });

  test("normalizes plain bad-request exceptions", () => {
    const { host, response } = createHost();

    new StableErrorFilter().catch(new BadRequestException("payload is invalid"), host);

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({
      error: {
        code: "REQUEST_INVALID",
        message: "payload is invalid",
        requestId: "request-123",
        details: null,
      },
    });
  });
});

class ErrorContractController {
  public httpError(): never {
    throw new HttpException(
      { code: "HTTP_FAILURE", message: "HTTP failure", details: { retryable: false } },
      409,
    );
  }

  public sessionError(): never {
    throw new SessionError("SESSION_INVALID", "Session is invalid");
  }

  public unhandledError(): never {
    throw new Error("database connection failed");
  }
}

class ErrorContractModule {}

Controller()(ErrorContractController);
for (const [method, path] of [
  ["httpError", "http-error"],
  ["sessionError", "session-error"],
  ["unhandledError", "unhandled-error"],
] as const) {
  const descriptor = Object.getOwnPropertyDescriptor(ErrorContractController.prototype, method);
  if (!descriptor) throw new Error(`missing controller method descriptor: ${method}`);
  Get(path)(ErrorContractController.prototype, method, descriptor);
}
Module({ controllers: [ErrorContractController] })(ErrorContractModule);

describe("StableErrorFilter Nest/Fastify integration", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const adapter = new FastifyAdapter({ genReqId: () => "integration-request" });
    app = await NestFactory.create<NestFastifyApplication>(ErrorContractModule, adapter, {
      logger: false,
    });
    app.useGlobalFilters(new StableErrorFilter());
    await app.init();
    await adapter.getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  test.each([
    {
      url: "/missing-route",
      status: 404,
      code: "REQUEST_INVALID",
      message: "Cannot GET /missing-route",
      details: null,
    },
    {
      url: "/http-error",
      status: 409,
      code: "HTTP_FAILURE",
      message: "HTTP failure",
      details: { retryable: false },
    },
    {
      url: "/session-error",
      status: 401,
      code: "SESSION_INVALID",
      message: "Session is invalid",
      details: null,
    },
    {
      url: "/unhandled-error",
      status: 500,
      code: "INTERNAL_ERROR",
      message: "Internal server error",
      details: null,
    },
  ])("normalizes $url", async ({ url, status, code, message, details }) => {
    const response = await app.inject({ method: "GET", url });

    expect(response.statusCode).toBe(status);
    expect(response.json()).toEqual({
      error: { code, message, requestId: "integration-request", details },
    });
  });
});

test("production bootstrap registers the stable filter globally", async () => {
  const bootstrap = await readFile(new URL("../main.ts", import.meta.url), "utf8");

  expect(bootstrap).toContain('import { StableErrorFilter } from "./security/error.filter.js";');
  expect(bootstrap).toContain("app.useGlobalFilters(new StableErrorFilter());");
});
