import { parseInstant } from "@dls/domain";
import { describe, expect, it } from "vitest";
import type { TransactionContext } from "../ports/transaction-manager.js";
import { advanceRelease, ReleaseAdvanceCriticalError } from "./advance-release.js";
import { cancelDeathWorkflow } from "./cancel-death-workflow.js";

type Row = Record<string, unknown>;

function copyRow(row: Row): Row {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      value instanceof Uint8Array ? new Uint8Array(value) : value,
    ]),
  );
}

function fixture(input?: Readonly<{ now?: string; releaseAt?: string }>) {
  let now = parseInstant(input?.now ?? "2026-08-10T02:29:59.999Z");
  const releaseAt = parseInstant(input?.releaseAt ?? "2026-08-10T02:30:00.000Z");
  const tables = new Map<string, Row[]>([
    [
      "workflows",
      [
        {
          id: "workflow-1",
          kind: "DEATH_CONFIRMATION",
          state: "RELEASE_PENDING",
          release_at: releaseAt,
          publish_locked_at: null,
          version: 4,
        },
      ],
    ],
    [
      "checkinSchedules",
      [
        {
          id: "schedule-1",
          schedule_version: 8,
          threshold_days: 30,
          status: "SUSPENDED",
          version: 3,
        },
      ],
    ],
    ["checkIns", []],
    ["ownerCredentials", [{ singleton_id: true, password_phc: "owner-hash", version: 2 }]],
    [
      "releaseSecretSessions",
      [
        {
          id: "release-session-1",
          workflow_id: "workflow-1",
          stage_key_envelope: new Uint8Array(48).fill(3),
          stage_key_nonce: new Uint8Array(24).fill(4),
          stage_key_protocol_version: 1,
          stage_key_version: 7,
          status: "ACTIVE",
          version: 0,
        },
      ],
    ],
    [
      "oneTimeTokens",
      [
        {
          id: "token-1",
          subject_id: "workflow-1",
          consumed_at: null,
          revoked_at: null,
          version: 0,
        },
      ],
    ],
  ]);
  const outbox: Row[] = [];
  const audits: Row[] = [];
  const idempotency = new Map<string, Row>();
  const repository = (table: string) => ({
    async findById(id: unknown) {
      return tables.get(table)?.find((row) => row.id === id || row.singleton_id === id) ?? null;
    },
    async findOneBy(field: string, value: unknown) {
      return tables.get(table)?.find((row) => row[field] === value) ?? null;
    },
    async findFirst() {
      return tables.get(table)?.[0] ?? null;
    },
    async findMany(field?: string, value?: unknown) {
      const rows = tables.get(table) ?? [];
      return field === undefined ? rows : rows.filter((row) => row[field] === value);
    },
    async insert(value: Row) {
      const row = { ...copyRow(value), version: Number(value.version ?? 0) };
      tables.set(table, [...(tables.get(table) ?? []), row]);
      return row;
    },
    async updateById(id: unknown, patch: Row) {
      const row = tables.get(table)?.find((candidate) => candidate.id === id);
      if (row === undefined) throw new Error(`missing ${table}`);
      Object.assign(row, copyRow(patch));
      return row;
    },
    async updateVersioned(id: unknown, expected: number, patch: Row) {
      const row = tables.get(table)?.find((candidate) => candidate.id === id);
      if (row === undefined || Number(row.version) !== expected) throw new Error(`stale ${table}`);
      Object.assign(row, copyRow(patch), { version: expected + 1 });
      return row;
    },
  });
  const repositories = {
    ownerProfile: repository("unused"),
    ownerCredentials: repository("ownerCredentials"),
    systemSettings: repository("unused"),
    checkIns: repository("checkIns"),
    checkinSchedules: repository("checkinSchedules"),
    contacts: repository("unused"),
    oneTimeTokens: repository("oneTimeTokens"),
    vaults: repository("unused"),
    workflows: repository("workflows"),
    releaseSecretSessions: repository("releaseSecretSessions"),
    packages: repository("unused"),
    idempotency: {
      async reserve(key: { actorScope: string; commandName: string; keyDigest: Uint8Array }) {
        const lookup = `${key.actorScope}:${key.commandName}:${Buffer.from(key.keyDigest).toString("hex")}`;
        const existing = idempotency.get(lookup);
        if (existing !== undefined) return existing;
        const row = { id: `idempotency-${idempotency.size + 1}`, ...key, status: "IN_PROGRESS" };
        idempotency.set(lookup, row);
        return row;
      },
      async complete(id: string, responseStatus: number, responseBody: unknown) {
        const row = [...idempotency.values()].find((candidate) => candidate.id === id);
        if (row === undefined) throw new Error("missing idempotency reservation");
        Object.assign(row, { status: "COMPLETED", responseStatus, responseBody });
        return row;
      },
    },
  } as unknown as TransactionContext["repositories"];
  const context = {
    repositories,
    clock: { now: async () => now },
    outbox: {
      enqueue: async (event: Row) => {
        outbox.push(copyRow(event));
        return { id: `outbox-${outbox.length}`, ...event };
      },
    },
    audit: { append: async (event: Row) => void audits.push(copyRow(event)) },
  } as unknown as TransactionContext;
  const transaction = {
    async run<T>(work: (tx: TransactionContext) => Promise<T>) {
      const tableSnapshot = new Map(
        [...tables].map(([name, rows]) => [name, rows.map(copyRow)] as const),
      );
      const outboxLength = outbox.length;
      const auditLength = audits.length;
      const idempotencySnapshot = new Map(
        [...idempotency].map(([key, row]) => [key, copyRow(row)] as const),
      );
      try {
        return await work(context);
      } catch (error) {
        tables.clear();
        for (const [name, rows] of tableSnapshot) tables.set(name, rows);
        outbox.length = outboxLength;
        audits.length = auditLength;
        idempotency.clear();
        for (const [key, row] of idempotencySnapshot) idempotency.set(key, row);
        throw error;
      }
    },
  };
  return {
    tables,
    outbox,
    audits,
    transaction,
    setNow(value: string) {
      now = parseInstant(value);
    },
  };
}

const stageKeys = {
  ingressKeyPair: async () => ({
    version: 1,
    publicKey: new Uint8Array(32),
    privateKey: new Uint8Array(32),
  }),
  currentStageKey: async () => ({ version: 7, key: new Uint8Array(32).fill(9) }),
  stageKey: async () => ({ version: 7, key: new Uint8Array(32).fill(9) }),
};

describe("release countdown", () => {
  it("requires the current master password and never accepts an owner session alone", async () => {
    for (const password of ["", "wrong-password"]) {
      const state = fixture();
      await expect(
        cancelDeathWorkflow(
          {
            workflowId: "workflow-1",
            ownerId: "owner-1",
            password,
            requestId: `cancel-${password || "session-only"}`,
          },
          {
            transaction: state.transaction,
            passwordVerifier: async (candidate, hash) =>
              candidate === "correct-password" && hash === "owner-hash",
          },
        ),
      ).rejects.toMatchObject({ code: "DLS-OWNER-REAUTH-REQUIRED", status: 401 });
      expect(state.tables.get("workflows")?.[0]?.state).toBe("RELEASE_PENDING");
    }
  });

  it("cancels at deadline minus one millisecond and destroys staged secrets and tokens", async () => {
    const state = fixture();
    const result = await cancelDeathWorkflow(
      {
        workflowId: "workflow-1",
        ownerId: "owner-1",
        password: "correct-password",
        requestId: "cancel-success",
      },
      {
        transaction: state.transaction,
        passwordVerifier: async (candidate, hash) =>
          candidate === "correct-password" && hash === "owner-hash",
      },
    );

    expect(result).toEqual({
      cancelled: true,
      workflowState: "CANCELLED",
      endedAt: "2026-08-10T02:29:59.999Z",
    });
    expect(state.tables.get("releaseSecretSessions")?.[0]).toMatchObject({
      status: "DESTROYED",
      stage_key_envelope: null,
      stage_key_nonce: null,
    });
    expect(state.tables.get("oneTimeTokens")?.[0]?.revoked_at).toBe("2026-08-10T02:29:59.999Z");
    await expect(
      cancelDeathWorkflow(
        {
          workflowId: "workflow-1",
          ownerId: "owner-1",
          password: "correct-password",
          requestId: "cancel-success",
        },
        {
          transaction: state.transaction,
          passwordVerifier: async () => true,
        },
      ),
    ).resolves.toEqual(result);
    expect(state.outbox.filter((row) => row.eventType === "DEATH_WORKFLOW_CANCELLED")).toHaveLength(
      1,
    );
  });

  it.each(["2026-08-10T02:30:00.000Z", "2026-08-10T02:30:00.001Z"])(
    "permanently rejects owner cancellation at or after the deadline: %s",
    async (now) => {
      const state = fixture({ now });
      await expect(
        cancelDeathWorkflow(
          {
            workflowId: "workflow-1",
            ownerId: "owner-1",
            password: "correct-password",
            requestId: `cancel-${now}`,
          },
          { transaction: state.transaction, passwordVerifier: async () => true },
        ),
      ).rejects.toMatchObject({ code: "DLS-RELEASE-LOCKED", status: 409 });
      expect(state.tables.get("workflows")?.[0]?.state).toBe("RELEASE_PENDING");
    },
  );

  it.each([
    ["2026-08-10T02:29:59.999Z", "WAITING"],
    ["2026-08-10T02:30:00.000Z", "LOCKED"],
    ["2026-08-10T02:30:00.001Z", "LOCKED"],
  ])("locks only when the database deadline is due: %s", async (now, status) => {
    const state = fixture({ now });
    await expect(
      advanceRelease(
        { workflowId: "workflow-1", aggregateVersion: 4 },
        { transaction: state.transaction, stageKeys },
      ),
    ).resolves.toMatchObject({ status });
    expect(state.tables.get("workflows")?.[0]?.publish_locked_at === null).toBe(
      status === "WAITING",
    );
  });

  it("makes duplicate workers idempotent and ignores stale jobs", async () => {
    const state = fixture({ now: "2026-08-10T02:30:00.000Z" });
    const first = await advanceRelease(
      { workflowId: "workflow-1", aggregateVersion: 4 },
      { transaction: state.transaction, stageKeys },
    );
    const duplicate = await advanceRelease(
      { workflowId: "workflow-1", aggregateVersion: 4 },
      { transaction: state.transaction, stageKeys },
    );
    expect(first).toMatchObject({ status: "LOCKED", workflowVersion: 5 });
    expect(duplicate).toMatchObject({ status: "ALREADY_LOCKED", workflowVersion: 5 });
    expect(
      state.outbox.filter((row) => row.eventType === "PUBLICATION_FINALIZE_REQUESTED"),
    ).toHaveLength(1);

    const stale = fixture({ now: "2026-08-10T02:30:00.000Z" });
    await expect(
      advanceRelease(
        { workflowId: "workflow-1", aggregateVersion: 3 },
        { transaction: stale.transaction, stageKeys },
      ),
    ).resolves.toEqual({ status: "STALE" });
    expect(stale.tables.get("workflows")?.[0]?.publish_locked_at).toBeNull();
  });

  it("rolls back crashes immediately before or after the publish-lock write", async () => {
    for (const position of ["before", "after"] as const) {
      const state = fixture({ now: "2026-08-10T02:30:00.000Z" });
      await expect(
        advanceRelease(
          { workflowId: "workflow-1", aggregateVersion: 4 },
          {
            transaction: state.transaction,
            stageKeys,
            ...(position === "before"
              ? { beforePublishLock: async () => Promise.reject(new Error("crash-before-lock")) }
              : { afterPublishLock: async () => Promise.reject(new Error("crash-after-lock")) }),
          },
        ),
      ).rejects.toThrow(`crash-${position}-lock`);
      expect(state.tables.get("workflows")?.[0]).toMatchObject({
        publish_locked_at: null,
        version: 4,
      });
      expect(state.outbox).toHaveLength(0);
    }
  });

  it("raises retryable critical health errors for missing or mismatched stage keys", async () => {
    for (const provider of [
      {
        ingressKeyPair: stageKeys.ingressKeyPair,
        currentStageKey: async () => Promise.reject(new Error("missing key")),
        stageKey: async () => Promise.reject(new Error("missing key")),
      },
      {
        ingressKeyPair: stageKeys.ingressKeyPair,
        currentStageKey: async () => ({ version: 8, key: new Uint8Array(32) }),
        stageKey: async () => ({ version: 8, key: new Uint8Array(32) }),
      },
    ]) {
      const state = fixture({ now: "2026-08-10T02:30:00.000Z" });
      const promise = advanceRelease(
        { workflowId: "workflow-1", aggregateVersion: 4 },
        { transaction: state.transaction, stageKeys: provider },
      );
      await expect(promise).rejects.toBeInstanceOf(ReleaseAdvanceCriticalError);
      await expect(promise).rejects.toMatchObject({
        code: "DLS-RELEASE-STAGE-KEY",
        severity: "CRITICAL",
        retryable: true,
      });
      expect(state.tables.get("workflows")?.[0]?.publish_locked_at).toBeNull();
    }
  });
});
