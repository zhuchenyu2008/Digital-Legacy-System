import { createDlsHttpClient } from "@dls/contracts";

let csrfToken: string | undefined;

const CSRF_COOKIE_NAMES = Object.freeze({
  OWNER: "dls-owner-csrf",
  CONTACT: "dls-contact-csrf",
});

function cookieValues(cookieHeader: string): Readonly<Record<string, string>> {
  return Object.fromEntries(
    cookieHeader.split(";").flatMap((part) => {
      const separator = part.indexOf("=");
      if (separator < 1) return [];
      const name = part.slice(0, separator).trim();
      try {
        return [[name, decodeURIComponent(part.slice(separator + 1).trim())]];
      } catch {
        return [];
      }
    }),
  );
}

export function browserCsrfToken(cookieHeader: string, pathname: string): string | undefined {
  const actor = pathname === "/contact" || pathname.startsWith("/contact/") ? "CONTACT" : "OWNER";
  return cookieValues(cookieHeader)[CSRF_COOKIE_NAMES[actor]];
}

function currentCsrfToken(): string | undefined {
  if (csrfToken !== undefined) return csrfToken;
  if (typeof document === "undefined" || typeof location === "undefined") return undefined;
  return browserCsrfToken(document.cookie, location.pathname);
}

export function setBrowserCsrfToken(value: string | undefined): void {
  csrfToken = value;
}

export function browserClient(fetchImplementation: typeof fetch = fetch) {
  return createDlsHttpClient({
    baseUrl: "/api",
    fetch: fetchImplementation,
    csrfTokenProvider: currentCsrfToken,
    requestIdProvider: () => globalThis.crypto?.randomUUID?.(),
  });
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("content-type", "application/json");
  const csrf = currentCsrfToken();
  if (csrf !== undefined) headers.set("x-csrf-token", csrf);
  const response = await fetch(`/api${path}`, {
    ...init,
    credentials: "same-origin",
    headers,
  });
  const requestId = response.headers.get("x-request-id") ?? undefined;
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { code?: string; message?: string };
    throw Object.assign(new Error(body.message ?? "请求失败"), {
      code: body.code,
      requestId,
      status: response.status,
    });
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
