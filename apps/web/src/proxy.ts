import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { isDevelopmentRuntime } from "./config/runtime-env";

const WASM_ROUTES = new Set([
  "/admin/contacts",
  "/admin/settings/password",
  "/contact-invitations",
  "/contact/password-change",
  "/contact/workflows/current",
  "/password-recovery",
  "/setup",
]);

export function contentSecurityPolicy(
  nonce: string,
  development: boolean,
  allowWasm: boolean,
): string {
  const scriptSources = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    // Only routes that actually create the isolated crypto worker get WASM compilation rights.
    ...(allowWasm ? ["'wasm-unsafe-eval'"] : []),
    ...(development ? ["'unsafe-eval'"] : []),
  ];
  return [
    "default-src 'self'",
    `script-src ${scriptSources.join(" ")}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "connect-src 'self'",
    "img-src 'self' blob: data:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID(), "utf8").toString("base64");
  const csp = contentSecurityPolicy(
    nonce,
    isDevelopmentRuntime(),
    WASM_ROUTES.has(request.nextUrl.pathname),
  );
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: "/((?!api|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
};
