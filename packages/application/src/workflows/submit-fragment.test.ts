import { createHash } from "node:crypto";
import { parseInstant } from "@dls/domain";
import { describe, expect, it } from "vitest";
import type { TransactionContext } from "../ports/transaction-manager.js";
import {
  processSubmittedFragment,
  submitFragment,
  WorkflowFragmentError,
} from "./submit-fragment.js";

function digest(value: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(value).digest());
}

function databaseCopy(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [
      key,
      value instanceof Uint8Array ? new Uint8Array(value) : value,
    ]),
  );
}

function fixture() {
  const commitment = new Uint8Array(64).fill(7);
  const tables = new Map<string, Array<Record<string, unknown>>>([
    [
      "workflows",
      [
        {
          id: "workflow-1",
          kind: "DEATH_CONFIRMATION",
          state: "AWAITING_CONFIRMATIONS",
          share_generation_id: "generation-1",
          version: 0,
        },
      ],
    ],
    ["workflowContacts", [{ workflow_id: "workflow-1", contact_id: "contact-1", version: 0 }]],
    [
      "contactKeyShares",
      [
        {
          id: "share-record-1",
          generation_id: "generation-1",
          contact_id: "contact-1",
          share_index: 2,
          death_share_commitment: commitment,
          recovery_share_commitment: new Uint8Array(64).fill(8),
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
          contact_count: 3,
          death_threshold: 3,
          recovery_threshold: 2,
          generation_commitment: new Uint8Array(32).fill(9),
          status: "ACTIVE",
          version: 0,
        },
      ],
    ],
    ["vaults", [{ id: "vault-1", vk_commitment: new Uint8Array(32).fill(10), version: 0 }]],
    ["workflowKeyFragments", []],
  ]);
  const repository = (table: string) => ({
    async findById(id: unknown) {
      return tables.get(table)?.find((row) => row.id === id) ?? null;
    },
    async findOneBy(field: string, value: unknown) {
      return tables.get(table)?.find((row) => row[field] === value) ?? null;
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
      const row = tables.get(table)?.find((value) => value.id === id);
      if (row === undefined) throw new Error(`missing ${table}`);
      Object.assign(row, databaseCopy(patch), { version: Number(row.version ?? 0) + 1 });
      return row;
    },
  });
  const outbox: Array<Record<string, unknown>> = [];
  const repositories = {
    ownerProfile: repository("unused"),
    ownerCredentials: repository("unused"),
    systemSettings: repository("unused"),
    checkIns: repository("unused"),
    checkinSchedules: repository("unused"),
    contacts: repository("unused"),
    shareGenerations: repository("shareGenerations"),
    contactKeyShares: repository("contactKeyShares"),
    vaults: repository("vaults"),
    workflows: repository("workflows"),
    workflowContacts: repository("workflowContacts"),
    workflowKeyFragments: repository("workflowKeyFragments"),
    packages: repository("unused"),
    idempotency: {} as never,
  } as unknown as TransactionContext["repositories"];
  const context = {
    repositories,
    clock: { now: async () => parseInstant("2026-08-09T01:00:00.000Z") },
    audit: { append: async () => undefined },
    outbox: {
      enqueue: async (event: Record<string, unknown>) => {
        outbox.push(event);
        return { id: "outbox-1", ...event };
      },
    },
  } as unknown as TransactionContext;
  return {
    commitment,
    outbox,
    tables,
    transaction: {
      run: async <T>(work: (tx: TransactionContext) => Promise<T>) => work(context),
    },
  };
}

function command(commitment: Uint8Array) {
  return {
    workflowId: "workflow-1",
    contactId: "contact-1",
    generationId: "generation-1",
    shareIndex: 2,
    purpose: "DEATH" as const,
    commitmentDigest: digest(commitment),
    ingressKeyVersion: 4,
    protocolVersion: 1 as const,
    nonce: new Uint8Array(24).fill(11),
    ciphertext: new Uint8Array(96).fill(12),
    requestId: "request-1",
    decisionDigest: digest(new TextEncoder().encode("exact legal confirmation")),
  };
}

describe("workflow fragment lifecycle", () => {
  it("stores only a context-bound pending envelope and schedules identifiers only", async () => {
    const state = fixture();
    const result = await submitFragment(command(state.commitment), {
      transaction: state.transaction,
      idFactory: () => "fragment-1",
    });

    expect(result).toEqual({ fragmentId: "fragment-1", status: "PENDING" });
    expect(state.tables.get("workflowKeyFragments")?.[0]).toMatchObject({
      id: "fragment-1",
      workflow_id: "workflow-1",
      contact_id: "contact-1",
      generation_id: "generation-1",
      share_index: 2,
      purpose: "DEATH",
      status: "PENDING",
      ingress_key_version: 4,
      stage_key_version: null,
      protocol_version: 1,
    });
    expect(state.outbox[0]).toMatchObject({
      payload: { workflowId: "workflow-1", contactId: "contact-1", fragmentId: "fragment-1" },
    });
    expect(JSON.stringify(state.outbox[0])).not.toContain("ciphertext");
  });

  it("rejects mixed workflow, purpose, generation, share-index, and commitment context", async () => {
    const state = fixture();
    const base = command(state.commitment);
    for (const patch of [
      { generationId: "stale-generation" },
      { shareIndex: 3 },
      { purpose: "RECOVERY" as const },
      { commitmentDigest: new Uint8Array(32).fill(5) },
      { protocolVersion: 2 as const },
    ]) {
      await expect(
        submitFragment({ ...base, ...patch } as never, { transaction: state.transaction }),
      ).rejects.toBeInstanceOf(WorkflowFragmentError);
    }
    expect(state.tables.get("workflowKeyFragments")).toHaveLength(0);
  });

  it("unwraps, verifies, stage-wraps, and zeroes process-owned plaintext and key copies", async () => {
    const state = fixture();
    await submitFragment(command(state.commitment), {
      transaction: state.transaction,
      idFactory: () => "fragment-1",
    });
    const observed: Uint8Array[] = [];
    const share = new Uint8Array(34).fill(21);
    const result = await processSubmittedFragment(
      { workflowId: "workflow-1", contactId: "contact-1", fragmentId: "fragment-1" },
      {
        transaction: state.transaction,
        stageKeys: {
          ingressKeyPair: async () => ({
            version: 4,
            publicKey: new Uint8Array(32).fill(31),
            privateKey: new Uint8Array(32).fill(32),
          }),
          currentStageKey: async () => ({ version: 6, key: new Uint8Array(32).fill(33) }),
        },
        cryptography: {
          openIngress: async ({ keyPair }) => {
            observed.push(keyPair.publicKey, keyPair.privateKey);
            return share;
          },
          verifyShare: async ({ context, plaintextShare }) => {
            observed.push(plaintextShare);
            expect(context).toMatchObject({
              workflowId: "workflow-1",
              generationId: "generation-1",
              shareIndex: 2,
              purpose: "DEATH",
              threshold: 3,
              shareCount: 3,
              vaultId: "vault-1",
            });
            expect(context.shareCommitment).toEqual(state.commitment);
            return true;
          },
          wrapStage: async ({ stageKey, plaintextShare }) => {
            observed.push(stageKey, plaintextShare);
            return {
              protocolVersion: 1,
              nonce: new Uint8Array(24).fill(41),
              ciphertext: new Uint8Array(64).fill(42),
            };
          },
        },
      },
    );

    expect(result).toEqual({ fragmentId: "fragment-1", status: "VALIDATED" });
    expect(state.tables.get("workflowKeyFragments")?.[0]).toMatchObject({
      status: "VALIDATED",
      ingress_key_version: 4,
      stage_key_version: 6,
      fragment_nonce: new Uint8Array(24).fill(41),
      fragment_ciphertext: new Uint8Array(64).fill(42),
    });
    expect(observed.every((value) => value.every((byte) => byte === 0))).toBe(true);
  });

  it("rejects and destroys invalid ingress material in the same locked transaction", async () => {
    const state = fixture();
    await submitFragment(command(state.commitment), {
      transaction: state.transaction,
      idFactory: () => "fragment-1",
    });
    const result = await processSubmittedFragment(
      { workflowId: "workflow-1", contactId: "contact-1", fragmentId: "fragment-1" },
      {
        transaction: state.transaction,
        stageKeys: {
          ingressKeyPair: async () => ({
            version: 4,
            publicKey: new Uint8Array(32).fill(31),
            privateKey: new Uint8Array(32).fill(32),
          }),
          currentStageKey: async () => ({ version: 6, key: new Uint8Array(32).fill(33) }),
        },
        cryptography: {
          openIngress: async () => new Uint8Array(34).fill(21),
          verifyShare: async () => false,
          wrapStage: async () => {
            throw new Error("must not stage-wrap an invalid share");
          },
        },
      },
    );

    expect(result).toEqual({ fragmentId: "fragment-1", status: "REJECTED" });
    expect(state.tables.get("workflowKeyFragments")?.[0]).toMatchObject({
      status: "REJECTED",
      stage_key_version: null,
      fragment_nonce: null,
      fragment_ciphertext: null,
    });
  });
});
