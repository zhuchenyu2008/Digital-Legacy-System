import { createHash } from "node:crypto";
import { parseInstant } from "@dls/domain";
import { describe, expect, it } from "vitest";
import type { TransactionContext } from "../ports/transaction-manager.js";
import { affirmDeath, deathConfirmationText } from "./affirm-death.js";
import { aliveConfirmationText, confirmAlive } from "./confirm-alive.js";
import {
  processReleaseFragment,
  type ReleaseFragmentCryptography,
} from "./process-release-fragment.js";

function copy(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [
      key,
      value instanceof Uint8Array ? new Uint8Array(value) : value,
    ]),
  );
}

function fixture() {
  const now = parseInstant("2026-08-09T02:30:00.000Z");
  const tables = new Map<string, Array<Record<string, unknown>>>([
    [
      "workflows",
      [
        {
          id: "workflow-1",
          kind: "DEATH_CONFIRMATION",
          state: "AWAITING_CONFIRMATIONS",
          contact_count_snapshot: 3,
          required_count_snapshot: 2,
          approved_count: 0,
          share_generation_id: "generation-1",
          package_id: "package-1",
          package_version_snapshot: 1,
          owner_display_name_snapshot_ciphertext: new Uint8Array([1]),
          owner_display_name_snapshot_nonce: new Uint8Array(12).fill(2),
          owner_display_name_snapshot_key_version: 1,
          version: 0,
        },
      ],
    ],
    [
      "workflowContacts",
      [1, 2, 3].map((index) => ({
        workflow_id: "workflow-1",
        contact_id: `contact-${index}`,
        share_index: index,
        version: 0,
      })),
    ],
    [
      "contacts",
      [1, 2, 3].map((index) => ({
        id: `contact-${index}`,
        status: "ACTIVE",
        password_phc: `hash-${index}`,
        version: 0,
      })),
    ],
    [
      "contactKeyShares",
      [1, 2, 3].map((index) => ({
        id: `share-${index}`,
        generation_id: "generation-1",
        contact_id: `contact-${index}`,
        share_index: index,
        death_share_commitment: new Uint8Array(64).fill(9),
        recovery_share_commitment: new Uint8Array(64).fill(8),
        version: 0,
      })),
    ],
    [
      "shareGenerations",
      [
        {
          id: "generation-1",
          vault_id: "vault-1",
          status: "ACTIVE",
          contact_count: 3,
          death_threshold: 2,
          recovery_threshold: 2,
          generation_commitment: new Uint8Array(64).fill(9),
          version: 0,
        },
      ],
    ],
    ["vaults", [{ id: "vault-1", vk_commitment: new Uint8Array(32).fill(7), version: 0 }]],
    [
      "checkinSchedules",
      [
        {
          id: "schedule-1",
          schedule_version: 7,
          threshold_days: 3,
          status: "TRIGGERED",
          version: 0,
        },
      ],
    ],
    ["workflowKeyFragments", []],
    ["workflowContactActions", []],
    ["releaseSecretSessions", []],
    ["checkIns", []],
    ["oneTimeTokens", []],
  ]);
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
    async insert(input: Record<string, unknown>) {
      const row = { ...copy(input), version: Number(input.version ?? 0) };
      tables.set(table, [...(tables.get(table) ?? []), row]);
      return row;
    },
    async updateById(id: unknown, patch: Record<string, unknown>) {
      const row = tables.get(table)?.find((value) => value.id === id);
      if (row === undefined) throw new Error(`missing ${table}`);
      Object.assign(row, copy(patch));
      return row;
    },
    async updateVersioned(id: unknown, expected: number, patch: Record<string, unknown>) {
      const row = tables.get(table)?.find((value) => value.id === id);
      if (row === undefined || Number(row.version ?? 0) !== expected) {
        throw new Error(`stale ${table}`);
      }
      Object.assign(row, copy(patch), { version: expected + 1 });
      return row;
    },
  });
  const outbox: Array<Record<string, unknown>> = [];
  const idempotency = new Map<string, Record<string, unknown>>();
  const repositories = {
    ownerProfile: repository("unused"),
    ownerCredentials: repository("unused"),
    systemSettings: repository("unused"),
    checkIns: repository("checkIns"),
    checkinSchedules: repository("checkinSchedules"),
    contacts: repository("contacts"),
    oneTimeTokens: repository("oneTimeTokens"),
    shareGenerations: repository("shareGenerations"),
    contactKeyShares: repository("contactKeyShares"),
    vaults: repository("vaults"),
    workflows: repository("workflows"),
    workflowContacts: repository("workflowContacts"),
    workflowContactActions: repository("workflowContactActions"),
    workflowKeyFragments: repository("workflowKeyFragments"),
    releaseSecretSessions: repository("releaseSecretSessions"),
    packages: repository("unused"),
    idempotency: {
      async reserve(key: { actorScope: string; commandName: string; keyDigest: Uint8Array }) {
        const lookup = `${key.actorScope}:${key.commandName}:${Buffer.from(key.keyDigest).toString("hex")}`;
        const existing = idempotency.get(lookup);
        if (existing !== undefined) return existing;
        const row = {
          id: `idem-${idempotency.size + 1}`,
          ...key,
          status: "IN_PROGRESS",
        };
        idempotency.set(lookup, row);
        return row;
      },
      async complete(id: string, responseStatus: number, responseBody: unknown) {
        const row = [...idempotency.values()].find((value) => value.id === id);
        if (row === undefined) throw new Error("missing idempotency row");
        Object.assign(row, { status: "COMPLETED", responseStatus, responseBody });
        return row;
      },
    },
  } as unknown as TransactionContext["repositories"];
  const context = {
    repositories,
    clock: { now: async () => now },
    audit: { append: async () => undefined },
    outbox: {
      enqueue: async (event: Record<string, unknown>) => {
        outbox.push(event);
        return { id: `outbox-${outbox.length}`, ...event };
      },
    },
  } as unknown as TransactionContext;
  return {
    now,
    outbox,
    tables,
    transaction: {
      run: async <T>(work: (tx: TransactionContext) => Promise<T>) => work(context),
    },
  };
}

function fragment(contact: number) {
  const commitment = new Uint8Array(64).fill(9);
  return {
    generationId: "generation-1",
    shareIndex: contact,
    commitmentDigest: new Uint8Array(createHash("sha256").update(commitment).digest()),
    ingressKeyVersion: 4,
    protocolVersion: 1 as const,
    nonce: new Uint8Array(24).fill(contact),
    ciphertext: new Uint8Array(96).fill(contact + 10),
  };
}

function fragmentDependencies(state: ReturnType<typeof fixture>) {
  return {
    transaction: state.transaction,
    stageKeys: {
      ingressKeyPair: async () => ({
        version: 4,
        publicKey: new Uint8Array(32).fill(1),
        privateKey: new Uint8Array(32).fill(2),
      }),
      currentStageKey: async () => ({ version: 6, key: new Uint8Array(32).fill(3) }),
      stageKey: async () => ({ version: 6, key: new Uint8Array(32).fill(3) }),
    },
    fragmentCryptography: {
      openIngress: async ({ context }: { context: { shareIndex: number } }) =>
        new Uint8Array(34).fill(context.shareIndex),
      verifyShare: async () => true,
      wrapStage: async ({ plaintextShare }: { plaintextShare: Uint8Array }) => ({
        protocolVersion: 1 as const,
        nonce: new Uint8Array(24).fill(4),
        ciphertext: new Uint8Array(plaintextShare),
      }),
    },
    releaseCryptography: {
      openStage: async (input: Parameters<ReleaseFragmentCryptography["openStage"]>[0]) =>
        new Uint8Array(34).fill(Number(input.fragment.share_index)),
      verifyShare: async () => true,
      reconstruct: async () => new Uint8Array(32).fill(5),
      commitVaultKey: async () => new Uint8Array(32).fill(7),
      wrapReleaseVaultKey: async () => ({
        protocolVersion: 1 as const,
        nonce: new Uint8Array(24).fill(6),
        ciphertext: new Uint8Array(48).fill(8),
      }),
    },
  };
}

describe("contact workflow decisions", () => {
  it("accepts only an exact reauthenticated affirmative and stores pending ingress only", async () => {
    const state = fixture();
    const result = await affirmDeath(
      {
        workflowId: "workflow-1",
        contactId: "contact-1",
        password: "password-1",
        confirmationText: deathConfirmationText("张三"),
        fragment: fragment(1),
        requestId: "request-1",
      },
      {
        transaction: state.transaction,
        passwordVerifier: async (password, hash) => password === "password-1" && hash === "hash-1",
        ownerDisplayName: async () => "张三",
        idFactory: () => "fragment-1",
      },
    );

    expect(result).toEqual({ accepted: true, processing: true, fragmentId: "fragment-1" });
    expect(state.tables.get("workflowKeyFragments")?.[0]).toMatchObject({
      status: "PENDING",
      decision_digest: new Uint8Array(
        createHash("sha256").update(deathConfirmationText("张三"), "utf8").digest(),
      ),
    });
    expect(state.tables.get("workflowContactActions")).toHaveLength(0);
    expect(JSON.stringify(state.outbox)).not.toContain("ciphertext");

    await expect(
      affirmDeath(
        {
          workflowId: "workflow-1",
          contactId: "contact-1",
          password: "password-1",
          confirmationText: deathConfirmationText("张三"),
          fragment: fragment(1),
          requestId: "request-1",
        },
        {
          transaction: state.transaction,
          passwordVerifier: async () => true,
          ownerDisplayName: async () => "张三",
          idFactory: () => "must-not-create-another-fragment",
        },
      ),
    ).resolves.toEqual(result);
    expect(state.tables.get("workflowKeyFragments")).toHaveLength(1);
  });

  it("rejects wrong password and any whitespace or punctuation deviation in legal text", async () => {
    const wrongPassword = fixture();
    await expect(
      affirmDeath(
        {
          workflowId: "workflow-1",
          contactId: "contact-1",
          password: "wrong",
          confirmationText: deathConfirmationText("张三"),
          fragment: fragment(1),
          requestId: "request-wrong-password",
        },
        {
          transaction: wrongPassword.transaction,
          passwordVerifier: async () => false,
          ownerDisplayName: async () => "张三",
        },
      ),
    ).rejects.toMatchObject({ code: "DLS-CONTACT-REAUTH-REQUIRED", status: 401 });
    expect(wrongPassword.tables.get("workflowKeyFragments")).toHaveLength(0);

    const wrongText = fixture();
    await expect(
      affirmDeath(
        {
          workflowId: "workflow-1",
          contactId: "contact-1",
          password: "password-1",
          confirmationText: `${deathConfirmationText("张三")} `,
          fragment: fragment(1),
          requestId: "request-wrong-text",
        },
        {
          transaction: wrongText.transaction,
          passwordVerifier: async () => true,
          ownerDisplayName: async () => "张三",
        },
      ),
    ).rejects.toMatchObject({ code: "DLS-CONTACT-CONFIRMATION-TEXT", status: 400 });
    expect(wrongText.tables.get("workflowKeyFragments")).toHaveLength(0);
  });

  it("records validated approvals and stages VK exactly once at the snapshotted threshold", async () => {
    const state = fixture();
    for (const contact of [1, 2]) {
      await affirmDeath(
        {
          workflowId: "workflow-1",
          contactId: `contact-${contact}`,
          password: `password-${contact}`,
          confirmationText: deathConfirmationText("张三"),
          fragment: fragment(contact),
          requestId: `request-${contact}`,
        },
        {
          transaction: state.transaction,
          passwordVerifier: async () => true,
          ownerDisplayName: async () => "张三",
          idFactory: () => `fragment-${contact}`,
        },
      );
    }

    const dependencies = fragmentDependencies(state);
    const first = await processReleaseFragment({ fragmentId: "fragment-1" }, dependencies);
    const firstReplay = await processReleaseFragment({ fragmentId: "fragment-1" }, dependencies);
    const second = await processReleaseFragment({ fragmentId: "fragment-2" }, dependencies);
    const replay = await processReleaseFragment({ fragmentId: "fragment-2" }, dependencies);

    expect(first).toMatchObject({
      status: "RECORDED",
      approvedCount: 1,
      thresholdReached: false,
      workflowState: "AWAITING_CONFIRMATIONS",
    });
    expect(firstReplay).toEqual(first);
    expect(second).toEqual({
      status: "RELEASE_PENDING",
      approvedCount: 2,
      thresholdReached: true,
      workflowState: "RELEASE_PENDING",
      releaseAt: "2026-08-10T02:30:00Z",
    });
    expect(replay).toEqual(second);
    expect(state.tables.get("workflowContactActions")).toHaveLength(2);
    expect(state.tables.get("releaseSecretSessions")?.[0]).toMatchObject({
      workflow_id: "workflow-1",
      stage_key_version: 6,
      stage_key_protocol_version: 1,
      expires_at: "2026-08-10T02:30:00Z",
    });
    expect(
      state.tables
        .get("workflowKeyFragments")
        ?.every(
          (row) =>
            row.status === "DESTROYED" &&
            row.fragment_ciphertext === null &&
            row.fragment_nonce === null,
        ),
    ).toBe(true);
  });

  it("lets one exact alive decision cancel, destroy fragments, and create a proxy check-in", async () => {
    const state = fixture();
    state.tables.get("workflowKeyFragments")?.push({
      id: "fragment-1",
      workflow_id: "workflow-1",
      contact_id: "contact-1",
      status: "VALIDATED",
      fragment_ciphertext: new Uint8Array([1]),
      fragment_nonce: new Uint8Array(24),
      stage_key_version: 6,
      version: 0,
    });

    const result = await confirmAlive(
      {
        workflowId: "workflow-1",
        contactId: "contact-1",
        password: "password-1",
        confirmationText: aliveConfirmationText("张三"),
        requestId: "request-alive",
      },
      {
        transaction: state.transaction,
        passwordVerifier: async () => true,
        ownerDisplayName: async () => "张三",
        idFactory: (() => {
          const ids = ["action-alive", "check-in-alive", "audit-alive"];
          return () => ids.shift() ?? "extra-id";
        })(),
      },
    );

    expect(result).toEqual({
      cancelled: true,
      workflowState: "CANCELLED",
      nextDeadlineAt: "2026-08-12T16:00:00Z",
    });
    expect(state.tables.get("workflowKeyFragments")?.[0]).toMatchObject({
      status: "DESTROYED",
      fragment_ciphertext: null,
      fragment_nonce: null,
      stage_key_version: null,
    });
    expect(state.tables.get("checkIns")?.[0]).toMatchObject({
      actor_type: "CONTACT",
      actor_ref: "contact-1",
      workflow_id: "workflow-1",
      beijing_date: "2026-08-09",
    });
    expect(state.tables.get("checkinSchedules")?.[0]).toMatchObject({
      status: "ACTIVE",
      deadline_at: "2026-08-12T16:00:00Z",
      schedule_version: 8,
    });
  });

  it("lets any rostered contact veto RELEASE_PENDING until the publish lock is committed", async () => {
    const state = fixture();
    Object.assign(state.tables.get("workflows")?.[0] ?? {}, {
      state: "RELEASE_PENDING",
      release_at: "2026-08-09T02:00:00.000Z",
      publish_locked_at: null,
      approved_count: 2,
    });
    state.tables.get("workflowContactActions")?.push({
      id: "prior-death-action",
      workflow_id: "workflow-1",
      contact_id: "contact-1",
      decision: "DECEASED",
      decision_digest: new Uint8Array([1]),
      created_at: "2026-08-08T00:00:00.000Z",
    });
    state.tables.get("releaseSecretSessions")?.push({
      id: "release-session-1",
      workflow_id: "workflow-1",
      status: "ACTIVE",
      stage_key_envelope: new Uint8Array(48),
      stage_key_nonce: new Uint8Array(24),
      version: 0,
    });

    await expect(
      confirmAlive(
        {
          workflowId: "workflow-1",
          contactId: "contact-1",
          password: "password-1",
          confirmationText: aliveConfirmationText("张三"),
          requestId: "release-pending-veto",
        },
        {
          transaction: state.transaction,
          passwordVerifier: async () => true,
          ownerDisplayName: async () => "张三",
          idFactory: () => crypto.randomUUID(),
        },
      ),
    ).resolves.toMatchObject({ cancelled: true, workflowState: "CANCELLED" });
    expect(state.tables.get("workflowContactActions")?.[0]).toMatchObject({
      id: "prior-death-action",
      decision: "ALIVE",
    });
    expect(state.tables.get("releaseSecretSessions")?.[0]).toMatchObject({
      status: "DESTROYED",
      stage_key_envelope: null,
      stage_key_nonce: null,
    });

    const locked = fixture();
    Object.assign(locked.tables.get("workflows")?.[0] ?? {}, {
      state: "RELEASE_PENDING",
      publish_locked_at: "2026-08-09T02:29:59.999Z",
    });
    await expect(
      confirmAlive(
        {
          workflowId: "workflow-1",
          contactId: "contact-2",
          password: "password-2",
          confirmationText: aliveConfirmationText("张三"),
          requestId: "release-locked-veto",
        },
        {
          transaction: locked.transaction,
          passwordVerifier: async () => true,
          ownerDisplayName: async () => "张三",
        },
      ),
    ).rejects.toMatchObject({ code: "DLS-RELEASE-LOCKED", status: 409 });
  });
});
