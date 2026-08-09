import { createDlsHttpClient } from "@dls/contracts";
import { headers } from "next/headers";

export async function serverClient() {
  const incoming = await headers();
  const cookie = incoming.get("cookie") ?? "";
  const baseUrl = process.env.DLS_API_INTERNAL_URL ?? "http://api:3001";
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

export async function serverApiRequest<T>(path: string): Promise<{ data?: T; status: number }> {
  const incoming = await headers();
  const response = await fetch(`${process.env.DLS_API_INTERNAL_URL ?? "http://api:3001"}${path}`, {
    cache: "no-store",
    headers: { cookie: incoming.get("cookie") ?? "", "x-request-id": incoming.get("x-request-id") ?? crypto.randomUUID() },
  });
  const body = response.ok ? await response.json().catch(() => undefined) as { data?: T } | undefined : undefined;
  return body?.data === undefined
    ? { status: response.status }
    : { data: body.data, status: response.status };
}
