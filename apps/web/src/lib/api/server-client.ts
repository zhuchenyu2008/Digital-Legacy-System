import { createDlsHttpClient } from "@dls/contracts";
import { headers } from "next/headers";
import { apiInternalBaseUrl } from "../../config/api-runtime";

export async function serverClient() {
  const incoming = await headers();
  const cookie = incoming.get("cookie") ?? "";
  const baseUrl = apiInternalBaseUrl();
  return createDlsHttpClient({
    baseUrl,
    fetch: (input, init) => {
      const request = new Request(input, init);
      const forwardedHeaders = new Headers(request.headers);
      forwardedHeaders.set("cookie", cookie);
      return fetch(new Request(request, { cache: "no-store", headers: forwardedHeaders }));
    },
    requestIdProvider: () => incoming.get("x-request-id") ?? undefined,
  });
}

export function apiDataFromBody<T>(body: unknown): T | undefined {
  if (body === null) return body as T;
  if (typeof body === "object" && body !== null && "data" in body) {
    return (body as { data?: T }).data;
  }
  return body as T | undefined;
}

export async function serverApiRequest<T>(path: string): Promise<{ data?: T; status: number }> {
  const incoming = await headers();
  const response = await fetch(`${apiInternalBaseUrl()}${path}`, {
    cache: "no-store",
    headers: {
      cookie: incoming.get("cookie") ?? "",
      "x-request-id": incoming.get("x-request-id") ?? crypto.randomUUID(),
    },
  });
  const body = response.ok ? await response.json().catch(() => undefined) : undefined;
  const data = apiDataFromBody<T>(body);
  return data === undefined ? { status: response.status } : { data, status: response.status };
}
