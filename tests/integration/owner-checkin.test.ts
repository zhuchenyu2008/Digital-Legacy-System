import { describe, expect, it } from "vitest";
import {
  InMemorySessionStore,
  SessionService,
} from "../../packages/application/src/auth/session-service.js";
import { loginOwner } from "../../packages/application/src/owner/login-owner.js";
import { updateOwnerSettings } from "../../packages/application/src/owner/update-settings.js";
import type { TransactionContext } from "../../packages/application/src/ports/transaction-manager.js";
import { parseInstant } from "../../packages/domain/src/shared/instant.js";

describe("owner login and check-in contract", () => {
  it("returns a rotated owner session and never returns password or key plaintext", async () => {
    const state = createConcurrentState();
    const result = await loginOwner(
      { password: "correct", requestId: "018f28a8-7f9a-7b32-9e41-4454f1c75691" },
      {
        transaction: state.transaction,
        sessionService: state.sessions,
        passwordVerifier: async () => true,
        ownerId: "owner-1",
      },
    );
    expect(result.session.token).not.toContain("password");
    expect(JSON.stringify(result)).not.toContain("password_phc");
  });

  it("serializes concurrent same-day check-ins without duplicate rows or regressions", async () => {
    const state = createConcurrentState();
    const input = { password: "correct", requestId: "018f28a8-7f9a-7b32-9e41-4454f1c75691" };
    const [first, second] = await Promise.all([
      loginOwner(input, {
        transaction: state.transaction,
        sessionService: state.sessions,
        passwordVerifier: async () => true,
        ownerId: "owner-1",
        idFactory: () => "check-in-one",
      }),
      loginOwner(
        { ...input, requestId: "018f28a8-7f9a-7b32-9e41-4454f1c75692" },
        {
          transaction: state.transaction,
          sessionService: state.sessions,
          passwordVerifier: async () => true,
          ownerId: "owner-1",
          idFactory: () => "check-in-two",
        },
      ),
    ]);
    expect(first.nextDeadlineAt).toBe("2026-08-11T14:00:00Z");
    expect(second.nextDeadlineAt).toBe("2026-08-11T14:00:00Z");
    expect(state.checkIns.filter((row) => row.beijing_date === "2026-08-08")).toHaveLength(1);
    expect(state.schedule.deadline_at).toBe("2026-08-11T14:00:00Z");
  });

  it("rejects settings mutations with a stale version before touching the schedule", async () => {
    const state = createConcurrentState();
    await expect(
      updateOwnerSettings(
        {
          ownerId: "owner-1",
          password: "correct",
          missedDaysThreshold: 5,
          expectedVersion: 1,
          requestId: "018f28a8-7f9a-7b32-9e41-4454f1c75693",
        },
        {
          transaction: state.transaction,
          passwordVerifier: async () => true,
        },
      ),
    ).rejects.toMatchObject({ code: "OWNER_SETTINGS_STALE" });
    expect(state.checkIns.filter((row) => row.beijing_date === "2026-08-08")).toHaveLength(0);
    expect(state.schedule.deadline_at).toBe("2026-08-10T14:00:00.000Z");
  });
});

function createConcurrentState() {
  const checkIns: Array<Record<string, unknown>> = [
    {
      id: "old-check-in",
      beijing_date: "2026-08-07",
      checked_in_at: "2026-08-07T14:00:00.000Z",
      version: 0,
    },
  ];
  const schedule: Record<string, unknown> = {
    id: "schedule-1",
    schedule_version: 1,
    last_check_in_id: "old-check-in",
    threshold_days: 3,
    deadline_at: "2026-08-10T14:00:00.000Z",
    status: "ACTIVE",
    version: 0,
  };
  const row = (table: string) => ({
    async findById(id: unknown) {
      if (table === "ownerProfile" && id === true)
        return { singleton_id: true, setup_state: "READY", version: 0 };
      if (table === "ownerCredentials" && id === true)
        return { singleton_id: true, password_phc: "hash", credential_version: 0, version: 0 };
      if (table === "checkIns") return checkIns.find((value) => value.id === id) ?? null;
      if (table === "checkinSchedules") return id === schedule.id ? schedule : null;
      return null;
    },
    async findOneBy(field: string, value: unknown) {
      if (table === "checkIns")
        return checkIns.find((rowValue) => rowValue[field] === value) ?? null;
      if (table === "checkinSchedules") return schedule[field] === value ? schedule : null;
      return null;
    },
    async findFirst() {
      return table === "checkinSchedules" ? schedule : null;
    },
    async insert(input: Record<string, unknown>) {
      const inserted = { ...input, version: 0 };
      if (table === "checkIns") checkIns.push(inserted);
      return inserted;
    },
    async updateVersioned(_id: unknown, _version: number, patch: Record<string, unknown>) {
      Object.assign(schedule, patch, { version: Number(schedule.version) + 1 });
      return schedule;
    },
  });
  const repositories = {
    ownerProfile: row("ownerProfile"),
    ownerCredentials: row("ownerCredentials"),
    systemSettings: row("systemSettings"),
    checkIns: row("checkIns"),
    checkinSchedules: row("checkinSchedules"),
    contacts: row("contacts"),
    vaults: row("vaults"),
    workflows: row("workflows"),
    packages: row("packages"),
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
  } as unknown as TransactionContext["repositories"];
  const context = {
    repositories,
    clock: { now: async () => parseInstant("2026-08-08T14:00:00.000Z") },
    outbox: { enqueue: async (event: Record<string, unknown>) => ({ ...event, id: "outbox" }) },
    audit: { append: async () => undefined },
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
  return {
    transaction,
    sessions: new SessionService(new InMemorySessionStore(), {
      pepper: new TextEncoder().encode("owner-session-pepper"),
      clock: { now: () => "2026-08-08T14:00:00.000Z" },
    }),
    checkIns,
    schedule,
  };
}
