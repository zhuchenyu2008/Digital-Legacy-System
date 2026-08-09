import { parseInstant } from "@dls/domain";
import { describe, expect, it } from "vitest";
import type { TransactionContext } from "../ports/transaction-manager.js";
import { evaluateCheckin } from "./evaluate-checkin.js";
import { getContactWorkflow } from "./get-contact-workflow.js";
import { getOwnerWorkflow } from "./get-owner-workflow.js";

function databaseCopy(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [
      key,
      value instanceof Uint8Array ? new Uint8Array(value) : value,
    ]),
  );
}

function fixture(
  overrides: Readonly<{
    now?: string;
    deadline?: string;
    ownerState?: string;
    recovery?: boolean;
  }> = {},
) {
  const tables = new Map<string, Array<Record<string, unknown>>>([
    [
      "ownerProfile",
      [
        {
          singleton_id: true,
          setup_state: overrides.ownerState ?? "ARMED",
          display_name_ciphertext: new Uint8Array([1, 2, 3]),
          display_name_nonce: new Uint8Array(12).fill(2),
          display_name_key_version: 1,
          version: 0,
        },
      ],
    ],
    ["systemSettings", [{ singleton_id: true, contact_set_version: 9, version: 0 }]],
    [
      "checkinSchedules",
      [
        {
          id: "schedule-1",
          schedule_version: 7,
          deadline_at: overrides.deadline ?? "2026-08-09T01:00:00.000Z",
          status: "ACTIVE",
          version: 0,
        },
      ],
    ],
    [
      "vaults",
      [
        {
          id: "vault-1",
          active_share_generation_id: "generation-1",
          vk_commitment: new Uint8Array(32).fill(4),
          version: 0,
        },
      ],
    ],
    [
      "shareGenerations",
      [
        {
          id: "generation-1",
          vault_id: "vault-1",
          status: "ACTIVE",
          contact_count: 3,
          death_threshold: 3,
          recovery_threshold: 2,
          version: 0,
        },
      ],
    ],
    ["packages", [{ id: "package-1", status: "ACTIVE", version_no: 4, version: 0 }]],
    [
      "contacts",
      [1, 2, 3].map((index) => ({
        id: `contact-${index}`,
        status: "ACTIVE",
        active_share_generation_id: "generation-1",
        display_name_ciphertext: new Uint8Array([10 + index]),
        display_name_nonce: new Uint8Array(12).fill(10 + index),
        display_name_key_version: 1,
        email_ciphertext: new Uint8Array([20 + index]),
        email_nonce: new Uint8Array(12).fill(20 + index),
        email_key_version: 1,
        email_lookup_hmac: new Uint8Array(32).fill(30 + index),
        x25519_public_key: new Uint8Array(32).fill(40 + index),
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
        death_share_ciphertext: new Uint8Array(48).fill(50 + index),
        death_share_commitment: new Uint8Array(64).fill(60 + index),
        recovery_share_ciphertext: new Uint8Array(48).fill(70 + index),
        recovery_share_commitment: new Uint8Array(64).fill(80 + index),
        share_protocol_version: 1,
        version: 0,
      })),
    ],
    [
      "workflows",
      overrides.recovery
        ? [
            {
              id: "recovery-1",
              kind: "PASSWORD_RECOVERY",
              state: "AWAITING_APPROVALS",
              share_generation_id: "generation-1",
              version: 0,
            },
          ]
        : [],
    ],
    ["workflowContacts", []],
    [
      "workflowKeyFragments",
      overrides.recovery
        ? [
            {
              id: "recovery-fragment-1",
              workflow_id: "recovery-1",
              status: "VALIDATED",
              fragment_ciphertext: new Uint8Array(32).fill(90),
              fragment_nonce: new Uint8Array(24).fill(91),
              stage_key_version: 1,
              version: 0,
            },
          ]
        : [],
    ],
    ["workflowContactActions", []],
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
      const row = { ...databaseCopy(input), version: 0 };
      tables.set(table, [...(tables.get(table) ?? []), row]);
      return row;
    },
    async updateById(id: unknown, patch: Record<string, unknown>) {
      const row = tables.get(table)?.find((value) => value.id === id);
      if (row === undefined) throw new Error(`missing ${table}`);
      Object.assign(row, databaseCopy(patch));
      return row;
    },
    async updateVersioned(id: unknown, _version: number, patch: Record<string, unknown>) {
      const row = tables.get(table)?.find((value) => value.id === id || value.singleton_id === id);
      if (row === undefined) throw new Error(`missing ${table}`);
      Object.assign(row, databaseCopy(patch), { version: Number(row.version ?? 0) + 1 });
      return row;
    },
  });
  const outbox: Array<Record<string, unknown>> = [];
  const audit: Array<Record<string, unknown>> = [];
  const repositories = {
    ownerProfile: repository("ownerProfile"),
    ownerCredentials: repository("unused"),
    systemSettings: repository("systemSettings"),
    checkIns: repository("unused"),
    checkinSchedules: repository("checkinSchedules"),
    contacts: repository("contacts"),
    shareGenerations: repository("shareGenerations"),
    contactKeyShares: repository("contactKeyShares"),
    vaults: repository("vaults"),
    workflows: repository("workflows"),
    workflowContacts: repository("workflowContacts"),
    workflowContactActions: repository("workflowContactActions"),
    workflowKeyFragments: repository("workflowKeyFragments"),
    packages: repository("packages"),
    idempotency: {} as never,
  } as unknown as TransactionContext["repositories"];
  const context = {
    repositories,
    clock: { now: async () => parseInstant(overrides.now ?? "2026-08-09T01:00:00.000Z") },
    outbox: {
      enqueue: async (event: Record<string, unknown>) => {
        outbox.push(event);
        return { id: `outbox-${outbox.length}`, ...event };
      },
    },
    audit: {
      append: async (event: Record<string, unknown>) => {
        audit.push(event);
      },
    },
  } as unknown as TransactionContext;
  return {
    audit,
    outbox,
    tables,
    transaction: {
      run: async <T>(work: (tx: TransactionContext) => Promise<T>) => work(context),
    },
  };
}

describe("overdue death workflow start", () => {
  it("does nothing before the persisted deadline and schedules the exact next evaluation", async () => {
    const state = fixture({ now: "2026-08-09T00:59:59.999Z" });
    const result = await evaluateCheckin(
      { scheduleId: "schedule-1", scheduleVersion: 7 },
      { transaction: state.transaction, idFactory: () => "workflow-1" },
    );
    expect(result).toEqual({ status: "NOT_DUE", deadlineAt: "2026-08-09T01:00:00Z" });
    expect(state.tables.get("workflows")).toHaveLength(0);
    expect(state.outbox).toEqual([
      expect.objectContaining({
        eventType: "CHECKIN_EVALUATE_REQUESTED",
        availableAt: "2026-08-09T01:00:00Z",
        payload: { aggregateId: "schedule-1", aggregateVersion: 7 },
      }),
    ]);
  });

  it("starts at the exact deadline, is repeat-safe, and refuses an unarmed owner", async () => {
    const state = fixture();
    const first = await evaluateCheckin(
      { scheduleId: "schedule-1", scheduleVersion: 7 },
      { transaction: state.transaction, idFactory: () => "workflow-1" },
    );
    const second = await evaluateCheckin(
      { scheduleId: "schedule-1", scheduleVersion: 7 },
      { transaction: state.transaction, idFactory: () => "unexpected" },
    );
    expect(first).toEqual({ status: "STARTED", workflowId: "workflow-1" });
    expect(second).toEqual({ status: "ALREADY_STARTED", workflowId: "workflow-1" });
    expect(state.tables.get("workflows")).toHaveLength(1);

    const unarmed = fixture({ ownerState: "READY" });
    await expect(
      evaluateCheckin(
        { scheduleId: "schedule-1", scheduleVersion: 7 },
        { transaction: unarmed.transaction },
      ),
    ).resolves.toEqual({ status: "NOT_ARMED" });
    expect(unarmed.tables.get("workflows")).toHaveLength(0);
  });

  it("cancels recovery and destroys its fragments before freezing the full death snapshot", async () => {
    const state = fixture({ recovery: true });
    await evaluateCheckin(
      { scheduleId: "schedule-1", scheduleVersion: 7 },
      { transaction: state.transaction, idFactory: () => "death-1" },
    );

    expect(state.tables.get("workflows")?.find((row) => row.id === "recovery-1")).toMatchObject({
      state: "CANCELLED",
      end_reason: "DEATH_WORKFLOW_PRIORITY",
    });
    expect(state.tables.get("workflowKeyFragments")?.[0]).toMatchObject({
      status: "DESTROYED",
      fragment_ciphertext: null,
      fragment_nonce: null,
      stage_key_version: null,
    });
    expect(state.tables.get("workflows")?.find((row) => row.id === "death-1")).toMatchObject({
      kind: "DEATH_CONFIRMATION",
      state: "AWAITING_CONFIRMATIONS",
      contact_count_snapshot: 3,
      required_count_snapshot: 3,
      share_generation_id: "generation-1",
      package_id: "package-1",
      package_version_snapshot: 4,
      schedule_version_snapshot: 7,
      deadline_snapshot_at: "2026-08-09T01:00:00Z",
    });
    expect(state.tables.get("workflowContacts")).toHaveLength(3);
    expect(state.tables.get("workflowContacts")?.[1]).toMatchObject({
      workflow_id: "death-1",
      contact_id: "contact-2",
      share_index: 2,
      contact_set_version: 9,
    });
    expect(
      state.outbox.filter((event) => event.eventType === "DEATH_CONFIRMATION_INVITATION_REQUESTED"),
    ).toHaveLength(3);
    expect(state.audit).toContainEqual(
      expect.objectContaining({ eventType: "DEATH_WORKFLOW_STARTED", result: "SUCCESS" }),
    );
    const scheduledData = JSON.stringify(state.outbox);
    expect(scheduledData).not.toMatch(/ciphertext|nonce|private|share/i);
  });
});

describe("scoped workflow queries", () => {
  it("shows an owner the full private snapshot but gives a contact only their participation", async () => {
    const state = fixture();
    await evaluateCheckin(
      { scheduleId: "schedule-1", scheduleVersion: 7 },
      { transaction: state.transaction, idFactory: () => "workflow-1" },
    );
    const owner = await getOwnerWorkflow(state.transaction);
    expect(owner).toMatchObject({
      workflowId: "workflow-1",
      state: "AWAITING_CONFIRMATIONS",
      contactCount: 3,
      requiredCount: 3,
      contacts: [
        { contactId: "contact-1", shareIndex: 1 },
        { contactId: "contact-2", shareIndex: 2 },
        { contactId: "contact-3", shareIndex: 3 },
      ],
    });

    const contact = await getContactWorkflow("contact-2", {
      transaction: state.transaction,
      ownerDisplayName: async () => "张三",
      ingressPublicKey: async () => ({ version: 4, publicKey: new Uint8Array(32).fill(99) }),
    });
    expect(contact).toMatchObject({
      workflowId: "workflow-1",
      ownerDisplayName: "张三",
      decisionAlreadyMade: false,
      approvedCount: 0,
      requiredCount: 3,
      legalNextActions: ["CONFIRM_DEATH", "CONFIRM_ALIVE"],
      share: { generationId: "generation-1", shareIndex: 2, protocolVersion: 1 },
      ingress: { purpose: "DEATH", version: 4 },
    });
    expect(JSON.stringify(contact)).not.toContain("contact-1");
    expect(JSON.stringify(contact)).not.toContain("contact-3");
  });
});
