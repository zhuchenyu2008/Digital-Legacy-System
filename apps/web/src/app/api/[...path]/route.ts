import { apiInternalBaseUrl } from "../../../config/api-runtime";

type RouteContext = Readonly<{ params: Promise<Readonly<{ path: readonly string[] }>> }>;

const HOP_BY_HOP_HEADERS = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
] as const;

const UNTRUSTED_FORWARDING_HEADERS = [
  "forwarded",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-port",
  "x-forwarded-proto",
] as const;

function forwardedHeaders(source: Headers): Headers {
  const headers = new Headers(source);
  headers.delete("host");
  headers.delete("content-length");
  for (const name of HOP_BY_HOP_HEADERS) headers.delete(name);
  for (const name of UNTRUSTED_FORWARDING_HEADERS) headers.delete(name);
  return headers;
}

function responseHeaders(source: Headers): Headers {
  const headers = new Headers(source);
  for (const name of HOP_BY_HOP_HEADERS) headers.delete(name);
  headers.delete("location");
  return headers;
}

async function proxy(
  request: Request,
  context: RouteContext,
  baseUrl = apiInternalBaseUrl(),
): Promise<Response> {
  const { path } = await context.params;
  const incomingUrl = new URL(request.url);
  const target = new URL(
    path.map((segment) => encodeURIComponent(segment)).join("/"),
    `${baseUrl.replace(/\/$/u, "")}/`,
  );
  target.search = incomingUrl.search;
  const method = request.method.toUpperCase();
  const init: RequestInit & { duplex?: "half" } = {
    method,
    headers: forwardedHeaders(request.headers),
    redirect: "manual",
  };
  if (method !== "GET" && method !== "HEAD") {
    init.body = request.body;
    init.duplex = "half";
  }
  const upstream = await fetch(new Request(target, init));
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders(upstream.headers),
  });
}

export function GET(request: Request, context: RouteContext, baseUrl?: string) {
  return proxy(request, context, baseUrl);
}

export function POST(request: Request, context: RouteContext, baseUrl?: string) {
  return proxy(request, context, baseUrl);
}

export function PUT(request: Request, context: RouteContext, baseUrl?: string) {
  return proxy(request, context, baseUrl);
}

export function PATCH(request: Request, context: RouteContext, baseUrl?: string) {
  return proxy(request, context, baseUrl);
}

export function DELETE(request: Request, context: RouteContext, baseUrl?: string) {
  return proxy(request, context, baseUrl);
}

export function HEAD(request: Request, context: RouteContext, baseUrl?: string) {
  return proxy(request, context, baseUrl);
}

export function OPTIONS(request: Request, context: RouteContext, baseUrl?: string) {
  return proxy(request, context, baseUrl);
}
