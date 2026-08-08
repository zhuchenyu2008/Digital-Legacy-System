import { randomUUID } from "node:crypto";

export type RequestHeaders = Readonly<Record<string, string | string[] | undefined>>;

export type RequestContext = Readonly<{
  requestId: string;
  ip: string;
  userAgent?: string;
}>;

const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function firstHeader(headers: RequestHeaders | undefined, name: string): string | undefined {
  const value = headers?.[name] ?? headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

export function readRequestContext(input: {
  headers?: RequestHeaders;
  ip?: string;
}): RequestContext {
  const requestId = firstHeader(input.headers, "x-request-id") ?? randomUUID();
  if (!requestIdPattern.test(requestId)) throw new Error("Invalid request ID");
  const ip = input.ip?.trim();
  if (ip === undefined || ip.length === 0) throw new Error("Request IP is required");
  const userAgent = firstHeader(input.headers, "user-agent");
  return Object.freeze({ requestId, ip, ...(userAgent === undefined ? {} : { userAgent }) });
}
