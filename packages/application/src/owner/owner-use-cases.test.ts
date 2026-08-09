import { parseInstant } from "@dls/domain";
import { describe, expect, it } from "vitest";
import { InMemorySessionStore, SessionService } from "../auth/session-service.js";
import type { TransactionContext } from "../ports/transaction-manager.js";
import { changeOwnerPassword } from "./change-owner-password.js";
import { loginOwner } from "./login-owner.js";
import { updateOwnerSettings } from "./update-settings.js";

type MutableRow = Record<string, unknown> & { version: number };

function fixture() {
  const rows = new Map<string, MutableRow[]>();
  const inserted: string[] = [];
  const updates: Array<{ table: string; patch: MutableRow }> = [];
  const put = (table: string, row: MutableRow) => rows.set(table, [row]);
  const putMany = (table: string, values: MutableRow[]) => rows.set(table, values);
  put("ownerProfile", {
    singleton_id: true,
    display_name_ciphertext: Uint8Array.of(1),
    primary_email_ciphertext: Uint8Array.of(2),
    setup_state: "READY",
    version: 0,
  });
  put("ownerCredentials", {
    singleton_id: true,
    password_phc: "valid-password-hash",
    credential_version: 0,
    version: 0,
  });
  put("systemSettings", {
    singleton_id: true,
    timezone: "Asia/Shanghai",
    missed_days_threshold: 3,
    settings_version: 0,
    version: 0,
  });
  putMany("checkIns", [
    {
      id: "old-check-in",
      beijing_date: "2026-08-07",
      checked_in_at: "2026-08-07T14:00:00.000Z",
      actor_type: "OWNER",
      version: 0,
    },
  ]);
  put("checkinSchedules", {
    id: "schedule-1",
    schedule_version: 1,
    last_check_in_id: "old-check-in",
    threshold_days: 3,
    deadline_at: "2026-08-10T14:00:00.000Z",
    status: "ACTIVE",
    version: 0,
  });
  put("vaults", {
    id: "vault-1",
    vk_commitment: new Uint8Array(32).fill(7),
    version: 0,
  });

  const repository = (table: string) => ({
    async findById(id: unknown) {
      return rows.get(table)?.find((row) => row.singleton_id === id || row.id === id) ?? null;
    },
    async findOneBy(field: string, value: unknown) {
      return rows.get(table)?.find((row) => row[field] === value) ?? null;
    },
    async findFirst() {
      return rows.get(table)?.[0] ?? null;
    },
    async insert(input: Record<string, unknown>) {
      const list = rows.get(table) ?? [];
      list.push({ ...input, version: 0 });
      rows.set(table, list);
      inserted.push(table);
      return list.at(-1) as MutableRow;
    },
    async updateVersioned(_id: unknown, _expectedVersion: number, patch: MutableRow) {
      const current = rows.get(table)?.[0];
      if (current === undefined) throw new Error(`missing ${table}`);
      Object.assign(current, patch, { version: Number(current.version ?? 0) + 1 });
      updates.push({ table, patch });
      return current;
    },
  });

  const transaction = {
    async run<T>(work: (tx: TransactionContext) => Promise<T>): Promise<T> {
      return work({
        repositories: {
          ownerProfile: repository("ownerProfile"),
          ownerCredentials: repository("ownerCredentials"),
          systemSettings: repository("systemSettings"),
          checkIns: repository("checkIns"),
          checkinSchedules: repository("checkinSchedules"),
          contacts: repository("contacts"),
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
            complete: async (id, responseStatus, responseBody) => ({
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
        },
        clock: { now: async () => parseInstant("2026-08-08T14:00:00.000Z") },
        outbox: {
          enqueue: async (event) => ({ ...event, id: "outbox-id" }),
        },
        audit: { append: async () => undefined },
      });
    },
  };

  const sessions = new SessionService(new InMemorySessionStore(), {
    pepper: new TextEncoder().encode("owner-session-pepper"),
    clock: { now: () => "2026-08-08T14:00:00.000Z" },
  });
  return { rows, inserted, updates, transaction, sessions };
}

describe("owner lifecycle use cases", () => {
  it("logs in and records exactly one Beijing-day check-in with the next deadline", async () => {
    const state = fixture();
    const first = await loginOwner(
      { password: "correct", requestId: "request-1" },
      {
        transaction: state.transaction,
        sessionService: state.sessions,
        passwordVerifier: async (password, hash) =>
          password === "correct" && hash === "valid-password-hash",
        idFactory: () => "new-check-in",
        ownerId: "owner-1",
      },
    );

    const second = await loginOwner(
      { password: "correct", requestId: "request-2" },
      {
        transaction: state.transaction,
        sessionService: state.sessions,
        passwordVerifier: async (password, hash) =>
          password === "correct" && hash === "valid-password-hash",
        idFactory: () => "unexpected-duplicate",
        ownerId: "owner-1",
      },
    );

    expect(first.checkedIn).toBe(true);
    expect(first.nextDeadlineAt).toBe("2026-08-11T16:00:00Z");
    expect(first.workflowCancellation.cancelled).toBe(false);
    expect(second.checkedIn).toBe(true);
    expect(state.inserted.filter((table) => table === "checkIns")).toHaveLength(1);
    expect(state.rows.get("checkinSchedules")?.[0]?.deadline_at).toBe("2026-08-11T16:00:00Z");
  });

  it("does not mutate check-in state after failed authentication", async () => {
    const state = fixture();
    await expect(
      loginOwner(
        { password: "wrong", requestId: "request-1" },
        {
          transaction: state.transaction,
          sessionService: state.sessions,
          passwordVerifier: async () => false,
          ownerId: "owner-1",
        },
      ),
    ).rejects.toMatchObject({ code: "OWNER_LOGIN_INVALID" });
    expect(state.inserted).toEqual([]);
    expect(state.updates).toEqual([]);
  });

  it("reauthenticates settings changes and rebuilds the deadline from the last check-in", async () => {
    const state = fixture();
    const result = await updateOwnerSettings(
      {
        ownerId: "owner-1",
        password: "correct",
        missedDaysThreshold: 5,
        expectedVersion: 0,
        requestId: "request-settings",
      },
      {
        transaction: state.transaction,
        passwordVerifier: async (password) => password === "correct",
        idFactory: () => "settings-event",
      },
    );
    expect(result.missedDaysThreshold).toBe(5);
    expect(state.rows.get("checkinSchedules")?.[0]?.deadline_at).toBe("2026-08-12T16:00:00Z");
    expect(state.updates.map((entry) => entry.table)).toEqual([
      "systemSettings",
      "checkinSchedules",
    ]);
  });

  it("changes the owner password atomically, preserves the VK commitment, and revokes old sessions", async () => {
    const state = fixture();
    const oldSession = await state.sessions.create({
      actorType: "OWNER",
      actorId: "owner-1",
      credentialVersion: 0,
    });
    const result = await changeOwnerPassword(
      {
        ownerId: "owner-1",
        oldPassword: "old-password",
        newPassword: "new-password-123",
        requestId: "request-password",
        newOwnerVaultEnvelope: {
          ciphertext: "Y2lwaGVydGV4dA",
          nonce: "YWFhYWFhYWFhYWFh",
          kdfSalt: "YmJiYmJiYmJiYmJiYmJiYg",
          kdfParams: {
            algorithm: "argon2id",
            memoryKiB: 65_536,
            iterations: 3,
            parallelism: 1,
            version: 19,
            purpose: "owner-vault-kek-v1",
          },
          keyVerifierCiphertext: "dmVyaWZpZXI",
          keyVerifierNonce: "YWFhYWFhYWFhYWFh",
          vkCommitment: "0707070707070707070707070707070707070707070707070707070707070707",
          ownerEnvelopeProof: "cHJvb2Y",
        },
      },
      {
        transaction: state.transaction,
        sessionService: state.sessions,
        passwordVerifier: async (password) => password === "old-password",
        passwordHasher: async () => "new-password-hash",
        idFactory: () => "password-event",
      },
    );
    expect(result.session.principal.credentialVersion).toBe(1);
    await expect(
      state.sessions.authenticate(oldSession.token, { actorType: "OWNER", actorId: "owner-1" }),
    ).rejects.toMatchObject({ code: "SESSION_INVALID" });
    expect(state.rows.get("ownerCredentials")?.[0]?.password_phc).toBe("new-password-hash");
  });
});
