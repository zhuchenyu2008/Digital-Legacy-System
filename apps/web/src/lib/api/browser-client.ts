import { createDlsHttpClient } from "@dls/contracts";

let csrfToken: string | undefined;

export function setBrowserCsrfToken(value: string | undefined): void {
  csrfToken = value;
}

export function browserClient(fetchImplementation: typeof fetch = fetch) {
  return createDlsHttpClient({
    baseUrl: "/api",
    fetch: fetchImplementation,
    csrfTokenProvider: () => csrfToken,
    requestIdProvider: () => globalThis.crypto?.randomUUID?.(),
  });
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const requestId = response.headers.get("x-request-id") ?? undefined;
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { code?: string; message?: string };
    throw Object.assign(new Error(body.message ?? "请求失败"), { code: body.code, requestId, status: response.status });
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
