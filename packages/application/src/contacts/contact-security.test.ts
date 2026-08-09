import { parseInstant } from "@dls/domain";
import { describe, expect, it } from "vitest";
import { InMemorySessionStore, SessionService } from "../auth/session-service.js";
import type { TransactionContext } from "../ports/transaction-manager.js";
import { changeContactPassword } from "./change-contact-password.js";
import { getContactCryptoMaterial } from "./get-crypto-material.js";
import { removeContact } from "./remove-contact.js";
import { requestContactPasswordChange } from "./request-password-change.js";

const replacementEnvelope = {
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

function fixture() {
  const rows = new Map<string, Array<Record<string, unknown>>>();
  rows.set("contacts", [
    {
      id: "contact-1",
      status: "ACTIVE",
      password_phc: "old-hash",
      credential_version: 0,
      version: 0,
      x25519_public_key: new Uint8Array(32).fill(1),
      private_key_ciphertext: Buffer.from("old-wrapper"),
      private_key_nonce: new Uint8Array(12),
      private_key_kdf_salt: new Uint8Array(16),
      private_key_kdf_params: replacementEnvelope.kdfParams,
    },
    { id: "contact-2", status: "ACTIVE", version: 0 },
    { id: "contact-3", status: "ACTIVE", version: 0 },
  ]);
  rows.set("vaults", [{ id: "vault-1", status: "ACTIVE", version: 0 }]);
  rows.set("oneTimeTokens", []);
  rows.set("ownerCredentials", [{ singleton_id: true, password_phc: "owner-hash", version: 0 }]);
  rows.set("systemSettings", [{ singleton_id: true, contact_set_version: 0, version: 0 }]);
  rows.set("workflows", []);
  const repository = (table: string) => ({
    async findById(id: unknown) {
      return rows.get(table)?.find((row) => row.id === id || row.singleton_id === id) ?? null;
    },
    async findOneBy(field: string, value: unknown) {
      return rows.get(table)?.find((row) => row[field] === value) ?? null;
    },
    async findFirst() {
      return rows.get(table)?.[0] ?? null;
    },
    async findMany(field?: string, value?: unknown) {
      const values = rows.get(table) ?? [];
      return field === undefined ? values : values.filter((row) => row[field] === value);
    },
    async insert(input: Record<string, unknown>) {
      const row = { ...input, version: 0 };
      rows.set(table, [...(rows.get(table) ?? []), row]);
      return row;
    },
    async updateVersioned(id: unknown, _version: number, patch: Record<string, unknown>) {
      const row = rows.get(table)?.find((value) => value.id === id || value.singleton_id === id);
      if (row === undefined) throw new Error(`missing ${table}`);
      Object.assign(row, patch, { version: Number(row.version ?? 0) + 1 });
      return row;
    },
    async updateById(id: unknown, patch: Record<string, unknown>) {
      const row = rows.get(table)?.find((value) => value.id === id);
      if (row === undefined) throw new Error(`missing ${table}`);
      Object.assign(row, patch);
      return row;
    },
  });
  const repositories = {
    ownerProfile: repository("ownerProfile"),
    ownerCredentials: repository("ownerCredentials"),
    systemSettings: repository("systemSettings"),
    checkIns: repository("checkIns"),
    checkinSchedules: repository("checkinSchedules"),
    contacts: repository("contacts"),
    oneTimeTokens: repository("oneTimeTokens"),
    vaults: repository("vaults"),
    workflows: repository("workflows"),
    packages: repository("packages"),
    idempotency: {} as never,
  };
  const context = {
    repositories,
    clock: { now: async () => parseInstant("2026-08-08T14:00:00.000Z") },
    outbox: { enqueue: async (event: Record<string, unknown>) => ({ ...event, id: "outbox" }) },
    audit: { append: async () => undefined },
  } as unknown as TransactionContext;
  const transaction = {
    run: async <T>(work: (tx: TransactionContext) => Promise<T>) => work(context),
  };
  const sessions = new SessionService(new InMemorySessionStore(), {
    pepper: new TextEncoder().encode("contact-session-pepper"),
    clock: { now: () => "2026-08-08T14:00:00.000Z" },
  });
  return { rows, transaction, sessions };
}

describe("contact security", () => {
  it("rotates the wrapped CSK without changing CPK and revokes old sessions", async () => {
    const state = fixture();
    const oldSession = await state.sessions.create({
      actorType: "CONTACT",
      actorId: "contact-1",
      credentialVersion: 0,
    });
    const result = await changeContactPassword(
      {
        contactId: "contact-1",
        oldPassword: "old-password",
        newPassword: "new-password-123",
        newPrivateKeyEnvelope: replacementEnvelope,
        requestId: "request-1",
        currentSessionToken: oldSession.token,
      },
      {
        transaction: state.transaction,
        sessionService: state.sessions,
        passwordVerifier: async (password) => password === "old-password",
        passwordHasher: async () => "new-hash",
      },
    );
    expect(result.session.principal.credentialVersion).toBe(1);
    expect(state.rows.get("contacts")?.[0]?.x25519_public_key).toEqual(new Uint8Array(32).fill(1));
    await expect(
      state.sessions.authenticate(oldSession.token, { actorType: "CONTACT", actorId: "contact-1" }),
    ).rejects.toMatchObject({ code: "SESSION_INVALID" });
  });

  it("creates a one-time password-change token as a digest and refuses to remove the last three contacts", async () => {
    const state = fixture();
    const token = await requestContactPasswordChange(
      {
        ownerId: "owner-1",
        contactId: "contact-1",
        password: "owner-password",
        requestId: "request-2",
      },
      {
        transaction: state.transaction,
        tokenPepper: new TextEncoder().encode("token-pepper"),
        passwordVerifier: async (password) => password === "owner-password",
        tokenFactory: () => new Uint8Array(32).fill(8),
      },
    );
    expect(JSON.stringify(state.rows.get("oneTimeTokens"))).not.toContain(token.token);
    await expect(
      removeContact(
        {
          ownerId: "owner-1",
          contactId: "contact-1",
          requestId: "request-remove",
          password: "owner-password",
        },
        { transaction: state.transaction, passwordVerifier: async () => true },
      ),
    ).rejects.toMatchObject({ code: "CONTACT_MINIMUM" });
  });

  it("returns only contact public key and encrypted wrapper", async () => {
    const state = fixture();
    const result = await getContactCryptoMaterial("contact-1", state.transaction);
    expect(result).not.toHaveProperty("password_phc");
    expect(result.publicKey).toHaveLength(43);
    expect(result.vaultId).toBe("vault-1");
    expect(result.privateKeyEnvelope).toHaveProperty("ciphertext");
  });
});
