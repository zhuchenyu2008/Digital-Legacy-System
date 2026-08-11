import type { Page } from "@playwright/test";

export type SimulationMilestone =
  | "CHECKIN_DUE"
  | "CONTACT_DECISION"
  | "RECOVERY_THRESHOLD"
  | "RELEASE_COUNTDOWN"
  | "SMTP_RETRY"
  | "PUBLICATION";

export type SimulationScenario = Readonly<{
  id: string;
  ownerId: string;
  currentAt: string;
  state: "READY" | SimulationMilestone;
  revision: number;
  synthetic: Readonly<{
    ownerEmail: string;
    contactEmails: readonly string[];
    contactIds: readonly string[];
    packageObjectKey: string;
    publicObjectKey: string;
    workflow: Readonly<{
      state:
        | "SCHEDULED"
        | "AWAITING_CONFIRMATIONS"
        | "RELEASE_PENDING"
        | "CANCELLED_ALIVE"
        | "CANCELLED_OWNER"
        | "PUBLISH_LOCKED"
        | "PUBLISHED";
      requiredCount: number;
      contactIds: readonly string[];
      contactDecisions: readonly Readonly<{
        contactId: string;
        decision: "ALIVE" | "DEATH_LIKELY";
        decidedAt: string;
      }>[];
      disclosureMailSent: boolean;
      rescheduledCheckinAt?: string;
      releaseAt?: string;
      publishLockedAt?: string;
      publication?: Readonly<{
        objectKey: string;
        publishedAt: string;
        willHtml: string;
        plaintextSha256: string;
      }>;
    }>;
  }>;
}>;

export type SimulationAdvance = Readonly<{
  simulationId: string;
  currentAt: string;
  state: SimulationMilestone;
  events: readonly Readonly<{ type: SimulationMilestone; occurredAt: string }>[];
}>;

type BrowserResponse = Readonly<{ status: number; body: unknown }>;
type SimulationActor = "owner" | "contact";
type SimulationRequestInit = Readonly<{
  method?: string;
  body?: unknown;
  idempotencyKey?: string;
  actor?: SimulationActor;
}>;

type SimulationContactSummary = Readonly<{ id: string; email: string }>;

export function selectSimulationContactIds(
  contacts: readonly SimulationContactSummary[],
  contactEmails: readonly string[],
): readonly string[] {
  const byEmail = new Map(contacts.map((contact) => [contact.email.trim().toLowerCase(), contact]));
  return Object.freeze(
    contactEmails.map((email) => {
      const contact = byEmail.get(email.trim().toLowerCase());
      if (contact === undefined) {
        throw new Error(`simulation contact is unavailable for ${email}`);
      }
      return contact.id;
    }),
  );
}

async function request<T>(page: Page, path: string, init: SimulationRequestInit = {}): Promise<T> {
  const response = await page.evaluate(
    async ({ path, method, body, idempotencyKey, actor }): Promise<BrowserResponse> => {
      const csrfCookieName = actor === "contact" ? "dls-contact-csrf" : "dls-owner-csrf";
      const csrf = document.cookie
        .split(";")
        .map((value) => value.trim())
        .find((value) => value.startsWith(`${csrfCookieName}=`))
        ?.slice(`${csrfCookieName}=`.length);
      const headers: Record<string, string> = {};
      if (body !== undefined) headers["content-type"] = "application/json";
      if (csrf !== undefined) headers["x-csrf-token"] = decodeURIComponent(csrf);
      if (idempotencyKey !== undefined) headers["idempotency-key"] = idempotencyKey;
      const result = await fetch(`/api${path}`, {
        method: method ?? "GET",
        credentials: "same-origin",
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const text = await result.text();
      let parsed: unknown;
      try {
        parsed = text.length === 0 ? undefined : JSON.parse(text);
      } catch {
        parsed = text;
      }
      return { status: result.status, body: parsed };
    },
    {
      path,
      method: init.method,
      body: init.body,
      idempotencyKey: init.idempotencyKey,
      actor: init.actor ?? "owner",
    },
  );
  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `simulation request ${path} failed with ${response.status}: ${JSON.stringify(response.body)}`,
    );
  }
  if (
    response.body !== undefined &&
    typeof response.body === "object" &&
    response.body !== null &&
    "data" in response.body
  ) {
    return (response.body as { data: T }).data;
  }
  return response.body as T;
}

export async function createSimulation(
  page: Page,
  simulationId = crypto.randomUUID(),
): Promise<SimulationScenario> {
  const contactEmails = [
    "contact-1@example.test",
    "contact-2@example.test",
    "contact-3@example.test",
  ] as const;
  const contacts = await request<readonly SimulationContactSummary[]>(page, "/owner/contacts");
  return request<SimulationScenario>(page, "/owner/simulations", {
    method: "POST",
    body: {
      simulationId,
      ownerEmail: "owner+simulation@example.test",
      contactEmails,
      contactIds: selectSimulationContactIds(contacts, contactEmails),
      startAt: "2026-08-10T00:00:00.000Z",
    },
  });
}

export async function advanceSimulation(
  page: Page,
  simulationId: string,
  target: SimulationMilestone,
): Promise<SimulationAdvance> {
  return request<SimulationAdvance>(page, `/owner/simulations/${simulationId}/advance`, {
    method: "POST",
    idempotencyKey: crypto.randomUUID(),
    body: { target },
  });
}

export async function readSimulation(
  page: Page,
  simulationId: string,
): Promise<SimulationScenario> {
  return request<SimulationScenario>(page, `/owner/simulations/${simulationId}`);
}

export async function resetSimulation(page: Page, simulationId: string): Promise<void> {
  await request<void>(page, `/owner/simulations/${simulationId}/reset`, {
    method: "POST",
  });
}

export async function recordSimulationContactDecision(
  page: Page,
  simulationId: string,
  decision: "ALIVE" | "DEATH_LIKELY",
): Promise<SimulationScenario> {
  return request<SimulationScenario>(page, `/contact/simulations/${simulationId}/decision`, {
    method: "POST",
    actor: "contact",
    body: { decision },
  });
}

export async function cancelSimulationOwner(
  page: Page,
  simulationId: string,
  password: string,
): Promise<SimulationScenario> {
  return request<SimulationScenario>(page, `/owner/simulations/${simulationId}/cancel`, {
    method: "POST",
    body: { password },
  });
}

export async function lockSimulationPublication(
  page: Page,
  simulationId: string,
): Promise<SimulationScenario> {
  return request<SimulationScenario>(page, `/owner/simulations/${simulationId}/publication/lock`, {
    method: "POST",
  });
}

export async function finalizeSimulationPublication(
  page: Page,
  simulationId: string,
): Promise<SimulationScenario> {
  return request<SimulationScenario>(
    page,
    `/owner/simulations/${simulationId}/publication/finalize`,
    {
      method: "POST",
    },
  );
}

export async function withSimulation<T>(page: Page, work: (id: string) => Promise<T>): Promise<T> {
  const scenario = await createSimulation(page);
  try {
    return await work(scenario.id);
  } finally {
    await resetSimulation(page, scenario.id).catch(() => undefined);
  }
}
