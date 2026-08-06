import createClient, { type Client } from "openapi-fetch";
import type { paths } from "./generated.js";

export type CsrfTokenProvider = () => string | undefined | Promise<string | undefined>;
export type RequestIdProvider = () => string | undefined | Promise<string | undefined>;

export type HttpClientOptions = Readonly<{
  baseUrl: string;
  fetch?: typeof fetch;
  csrfTokenProvider?: CsrfTokenProvider;
  requestIdProvider?: RequestIdProvider;
}>;

export type DlsHttpClient = Client<paths>;

export function createDlsHttpClient(options: HttpClientOptions): DlsHttpClient {
  const injectedFetch = options.fetch;
  const client = injectedFetch
    ? createClient<paths>({
        baseUrl: options.baseUrl,
        fetch: (request) => injectedFetch(request),
      })
    : createClient<paths>({ baseUrl: options.baseUrl });

  client.use({
    async onRequest({ request }) {
      const csrf = await options.csrfTokenProvider?.();
      const requestId = await options.requestIdProvider?.();
      if (csrf) {
        request.headers.set("x-csrf-token", csrf);
      }
      if (requestId) {
        request.headers.set("x-request-id", requestId);
      }
      return request;
    },
  });

  return client;
}
