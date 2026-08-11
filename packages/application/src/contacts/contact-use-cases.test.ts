import { parseInstant } from "@dls/domain";
import { describe, expect, it } from "vitest";
import { InMemorySessionStore, SessionService } from "../auth/session-service.js";
import type { TransactionContext } from "../ports/transaction-manager.js";
import { acceptContactInvitation } from "./accept-invitation.js";
import { inviteContact } from "./invite-contact.js";
import { loginContact } from "./login-contact.js";
import { viewContactInvitation } from "./view-invitation.js";

const envelope = {
  publicKey: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE",
  ciphertext: "Y2lwaGVydGV4dA",
  nonce: "YWFhYWFhYWFhYWFh",
  kdfSalt: "YmJiYmJiYmJiYmJiYmJiYg",
  kdfParams: {
    algorithm: "argon2id" as const,
    memoryKiB: 65_536,
    iterations: 3,
    parallelism: 1,
    version: 19,
    purpose: "contact-private-key-kek-v1" as const,
  },
  privateKeyProof: "cHJvb2Y",
};

const consent = {
  version: "2026-08-01",
  documentSha256: "0707070707070707070707070707070707070707070707070707070707070707",
  termsAccepted: true,
  privacyAccepted: true,
  denialDisclosureAccepted: true,
  stage2LockAccepted: true,
};

function fixture() {
  const rows = new Map<string, Array<Record<string, unknown>>>();
  const audit: Array<Record<string, unknown>> = [];
  const outbox: Array<Record<string, unknown>> = [];
  const insertions: string[] = [];
  const settings = {
    singleton_id: true,
    contact_set_version: 0,
    contact_consent_version: "2026-08-01",
    contact_consent_sha256: new Uint8Array(32).fill(7),
    version: 0,
  };
  rows.set("systemSettings", [settings]);
  rows.set("contacts", []);
  rows.set("contactInvitations", []);
  rows.set("contactConsents", []);
  rows.set("vaults", [{ id: "vault-1" }]);
  rows.set("workflows", []);

  const repository = (table: string) => ({
    async findById(id: unknown) {
      return (
        rows.get(table)?.find((row) => matches(row.id, id) || matches(row.singleton_id, id)) ?? null
      );
    },
    async findOneBy(field: string, value: unknown) {
      return rows.get(table)?.find((row) => matches(row[field], value)) ?? null;
    },
    async findFirst() {
      return rows.get(table)?.[0] ?? null;
    },
    async findMany(field?: string, value?: unknown) {
      const values = rows.get(table) ?? [];
      return field === undefined ? values : values.filter((row) => matches(row[field], value));
    },
    async insert(input: Record<string, unknown>) {
      const inserted = { ...input, version: 0 };
      rows.set(table, [...(rows.get(table) ?? []), inserted]);
      insertions.push(table);
      return inserted;
    },
    async updateVersioned(id: unknown, _expectedVersion: number, patch: Record<string, unknown>) {
      const current = rows
        .get(table)
        ?.find((row) => matches(row.id, id) || matches(row.singleton_id, id));
      if (current === undefined) throw new Error(`missing ${table}`);
      Object.assign(current, patch, { version: Number(current.version ?? 0) + 1 });
      return current;
    },
    async updateById(id: unknown, patch: Record<string, unknown>) {
      const current = rows.get(table)?.find((row) => matches(row.id, id));
      if (current === undefined) throw new Error(`missing ${table}`);
      Object.assign(current, patch);
      return current;
    },
  });
  const repositories = {
    ownerProfile: repository("ownerProfile"),
    ownerCredentials: repository("ownerCredentials"),
    systemSettings: repository("systemSettings"),
    checkIns: repository("checkIns"),
    checkinSchedules: repository("checkinSchedules"),
    contacts: repository("contacts"),
    contactInvitations: repository("contactInvitations"),
    contactConsents: repository("contactConsents"),
    vaults: repository("vaults"),
    workflows: repository("workflows"),
    packages: repository("packages"),
    idempotency: {
      reserve: async () => ({
        id: "idempotency",
        actorScope: "owner",
        commandName: "test",
        keyDigest: new Uint8Array(32),
        requestHash: new Uint8Array(32),
        status: "IN_PROGRESS" as const,
      }),
      complete: async (id: string, responseStatus: number, responseBody: unknown) => ({
        id,
        actorScope: "owner",
        commandName: "test",
        keyDigest: new Uint8Array(32),
        requestHash: new Uint8Array(32),
        status: "COMPLETED" as const,
        responseStatus,
        responseBody,
      }),
    },
  };
  const context = {
    repositories,
    clock: { now: async () => parseInstant("2026-08-08T14:00:00.000Z") },
    outbox: {
      enqueue: async (event: Record<string, unknown>) => {
        outbox.push(event);
        return { ...event, id: "outbox" };
      },
    },
    audit: {
      append: async (event: Record<string, unknown>) => {
        audit.push(event);
      },
    },
  } as unknown as TransactionContext;
  let tail = Promise.resolve();
  const transaction = {
    async run<T>(work: (tx: TransactionContext) => Promise<T>): Promise<T> {
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        return await work(context);
      } finally {
        release();
      }
    },
  };
  const sessions = new SessionService(new InMemorySessionStore(), {
    pepper: new TextEncoder().encode("contact-session-pepper"),
    clock: { now: () => "2026-08-08T14:00:00.000Z" },
  });
  return { rows, audit, outbox, insertions, transaction, sessions };
}

function matches(left: unknown, right: unknown): boolean {
  if (left instanceof Uint8Array && right instanceof Uint8Array) {
    return Buffer.from(left).equals(Buffer.from(right));
  }
  return left === right;
}

function dependencies(state: ReturnType<typeof fixture>) {
  return {
    transaction: state.transaction,
    tokenPepper: new TextEncoder().encode("contact-token-pepper"),
    tokenFactory: () => new Uint8Array(32).fill(9),
    idFactory: (() => {
      let index = 0;
      return () => `00000000-0000-0000-0000-00000000000${++index}`;
    })(),
    emailLookupHmac: async (value: string) => new TextEncoder().encode(`email:${value}`),
    fieldProtector: {
      protect: async (value: string) => ({
        ciphertext: new TextEncoder().encode(`protected:${value}`),
        nonce: new Uint8Array(12),
        keyVersion: 1,
        lookupHmac: new TextEncoder().encode(`email:${value}`),
      }),
    },
    passwordHasher: async () => "$argon2id$v=19$m=65536,t=3,p=1$hash",
    passwordVerifier: async (password: string) => password === "correct-password",
    consentVersion: "2026-08-01",
    consentDocumentSha256: new Uint8Array(32).fill(7),
    sessionService: state.sessions,
  };
}

describe("contact invitation and authentication", () => {
  it("stores only a token digest and rejects an email collision", async () => {
    const state = fixture();
    const deps = dependencies(state);
    const invitation = await inviteContact(
      {
        ownerId: "owner-1",
        displayName: "李四",
        email: "lisi@example.com",
        requestId: "request-1",
      },
      deps,
    );
    expect(invitation.token).not.toBe(Buffer.from(deps.tokenPepper).toString("base64url"));
    expect(JSON.stringify(state.rows.get("contactInvitations"))).not.toContain(invitation.token);
    await expect(
      inviteContact(
        {
          ownerId: "owner-1",
          displayName: "王五",
          email: "lisi@example.com",
          requestId: "request-2",
        },
        deps,
      ),
    ).rejects.toMatchObject({ code: "CONTACT_EMAIL_EXISTS" });
  });

  it("queues the invitation notification in the same transaction without persisting the raw token", async () => {
    const state = fixture();
    const deps = dependencies(state);
    let queued: Readonly<{ token: string; contactId: string; invitationId: string }> | undefined;
    const invitation = await inviteContact(
      {
        ownerId: "owner-1",
        displayName: "李四",
        email: "lisi@example.com",
        requestId: "request-1",
      },
      {
        ...deps,
        queueInvitationNotification: async (input) => {
          queued = input;
          return "00000000-0000-0000-0000-000000000099";
        },
      },
    );

    expect(queued).toMatchObject({
      token: invitation.token,
      contactId: invitation.contactId,
      invitationId: invitation.invitationId,
    });
    expect(state.rows.get("contactInvitations")?.[0]?.notification_id).toBe(
      "00000000-0000-0000-0000-000000000099",
    );
    expect(JSON.stringify(state.rows.get("contactInvitations"))).not.toContain(invitation.token);
  });

  it("resolves a pending PostgreSQL-shaped invitation with null lifecycle timestamps", async () => {
    const state = fixture();
    const deps = dependencies(state);
    const invitation = await inviteContact(
      {
        ownerId: "owner-1",
        displayName: "李四",
        email: "lisi@example.com",
        requestId: "request-1",
      },
      deps,
    );
    Object.assign(state.rows.get("contactInvitations")?.[0] ?? {}, {
      consumed_at: null,
      revoked_at: null,
    });

    await expect(
      viewContactInvitation(invitation.token, {
        transaction: state.transaction,
        tokenPepper: deps.tokenPepper,
      }),
    ).resolves.toEqual({
      contactId: invitation.contactId,
      status: "INVITED",
      expiresAt: invitation.expiresAt,
      vaultId: "vault-1",
      consentVersion: "2026-08-01",
      consentDocumentSha256: "07".repeat(32),
    });
  });

  it("captures exact consent and consumes the invitation exactly once", async () => {
    const state = fixture();
    const deps = dependencies(state);
    const invitation = await inviteContact(
      {
        ownerId: "owner-1",
        displayName: "李四",
        email: "lisi@example.com",
        requestId: "request-1",
      },
      deps,
    );
    Object.assign(state.rows.get("contactInvitations")?.[0] ?? {}, {
      consumed_at: null,
      revoked_at: null,
    });
    const accepted = await acceptContactInvitation(
      {
        token: invitation.token,
        password: "correct-password",
        privateKeyEnvelope: envelope,
        consent,
        requestId: "request-accept",
      },
      deps,
    );
    expect(accepted.status).toBe("PENDING_KEYING");
    expect(state.rows.get("contactConsents")?.[0]?.consent_version).toBe("2026-08-01");
    expect(state.rows.get("contactInvitations")?.[0]?.consumed_at).toBe("2026-08-08T14:00:00Z");
    await expect(
      acceptContactInvitation(
        {
          token: invitation.token,
          password: "correct-password",
          privateKeyEnvelope: envelope,
          consent,
          requestId: "request-replay",
        },
        deps,
      ),
    ).rejects.toMatchObject({ code: "CONTACT_INVITATION_INVALID" });
  });

  it("serializes concurrent acceptance and returns a contact session without secret material", async () => {
    const state = fixture();
    const deps = dependencies(state);
    const invitation = await inviteContact(
      {
        ownerId: "owner-1",
        displayName: "李四",
        email: "lisi@example.com",
        requestId: "request-1",
      },
      deps,
    );
    const [first, second] = await Promise.allSettled([
      acceptContactInvitation(
        {
          token: invitation.token,
          password: "correct-password",
          privateKeyEnvelope: envelope,
          consent,
          requestId: "request-a",
        },
        deps,
      ),
      acceptContactInvitation(
        {
          token: invitation.token,
          password: "correct-password",
          privateKeyEnvelope: envelope,
          consent,
          requestId: "request-b",
        },
        deps,
      ),
    ]);
    expect([first, second].filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const login = await loginContact(
      { displayName: "李四", password: "correct-password", requestId: "request-login" },
      { ...deps, contactLookupHmac: deps.emailLookupHmac },
    );
    expect(login.session.principal.actorType).toBe("CONTACT");
    expect(JSON.stringify(login)).not.toContain("password_phc");
    expect(login).not.toHaveProperty("privateKeyPlaintext");
  });
});
