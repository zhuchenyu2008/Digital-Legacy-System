export type MailpitMessageSummary = Readonly<{
  ID: string;
  Subject: string;
  To: readonly Readonly<{ Address: string }>[];
}>;

export type MailpitMessage = MailpitMessageSummary &
  Readonly<{
    HTML: string;
    Text: string;
  }>;

export function validateMailpitApiUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname)) {
    throw new Error("Mailpit API must use a loopback HTTP URL");
  }
  return url;
}

function hrefs(html: string): readonly string[] {
  return [...html.matchAll(/\bhref\s*=\s*["']([^"']+)["']/giu)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
}

export function extractFragmentLink(html: string, applicationBaseUrl: string): URL {
  const application = new URL(applicationBaseUrl);
  for (const href of hrefs(html)) {
    const candidate = new URL(href, application);
    if (candidate.hash.length === 0) continue;
    if (candidate.origin !== application.origin) {
      throw new Error("Mailpit link must be same-origin with the E2E application");
    }
    return candidate;
  }
  throw new Error("Mailpit message does not contain an application fragment link");
}

export class MailpitClient {
  readonly #baseUrl: URL;

  public constructor(
    value: string,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {
    this.#baseUrl = validateMailpitApiUrl(value);
  }

  async #json<T>(path: string): Promise<T> {
    const response = await this.fetchImplementation(new URL(path, this.#baseUrl), {
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`Mailpit API request failed with ${response.status}`);
    return response.json() as Promise<T>;
  }

  public async messages(): Promise<readonly MailpitMessageSummary[]> {
    const response = await this.#json<{ messages?: readonly MailpitMessageSummary[] }>(
      "/api/v1/messages",
    );
    return response.messages ?? [];
  }

  public message(id: string): Promise<MailpitMessage> {
    if (!/^[A-Za-z0-9_-]+$/u.test(id)) throw new Error("Mailpit message ID is invalid");
    return this.#json<MailpitMessage>(`/api/v1/message/${id}`);
  }

  public async waitFor(
    input: Readonly<{ recipient: string; subject: RegExp }>,
  ): Promise<MailpitMessage> {
    const deadline = Date.now() + 15_000;
    do {
      for (const message of await this.messages()) {
        if (
          message.To.some((recipient) => recipient.Address === input.recipient) &&
          input.subject.test(message.Subject)
        ) {
          return this.message(message.ID);
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    } while (Date.now() < deadline);
    throw new Error(`Mailpit message was not received for ${input.recipient}`);
  }
}
