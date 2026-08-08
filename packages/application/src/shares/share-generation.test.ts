import { parseInstant } from "@dls/domain";
import { describe, expect, it } from "vitest";
import type { TransactionContext } from "../ports/transaction-manager.js";
import { activateShareGeneration } from "./activate-generation.js";
import { createShareGeneration } from "./create-generation.js";
import { generationProof } from "./share-generation-common.js";
import { uploadShareGeneration } from "./upload-generation.js";

function fixture() {
  const tables = new Map<string, Array<Record<string, unknown>>>();
  tables.set("contacts", [
    {
      id: "contact-1",
      status: "ACTIVE",
      x25519_public_key: new Uint8Array(32).fill(1),
      version: 0,
    },
    {
      id: "contact-2",
      status: "ACTIVE",
      x25519_public_key: new Uint8Array(32).fill(2),
      version: 0,
    },
    {
      id: "contact-3",
      status: "ACTIVE",
      x25519_public_key: new Uint8Array(32).fill(3),
      version: 0,
    },
  ]);
  tables.set("shareGenerations", []);
  tables.set("contactKeyShares", []);
  tables.set("systemSettings", [{ singleton_id: true, contact_set_version: 4, version: 0 }]);
  tables.set("vaults", [
    {
      id: "vault-1",
      active_share_generation_id: null,
      vk_commitment: new Uint8Array(32).fill(7),
      version: 0,
    },
  ]);
  tables.set("ownerProfile", [
    {
      singleton_id: true,
      setup_state: "READY",
      irreversibility_accepted_at: "2026-08-01T00:00:00.000Z",
      version: 0,
    },
  ]);
  tables.set("packages", [{ id: "package-1", status: "ACTIVE", version: 0 }]);
  tables.set("workflows", []);

  const repository = (table: string) => ({
    async findById(id: unknown) {
      return tables.get(table)?.find((row) => row.id === id || row.singleton_id === id) ?? null;
    },
    async findOneBy(field: string, value: unknown) {
      return tables.get(table)?.find((row) => row[field] === value) ?? null;
    },
    async findMany(field?: string, value?: unknown) {
      const rows = tables.get(table) ?? [];
      return field === undefined ? rows : rows.filter((row) => row[field] === value);
    },
    async insert(input: Record<string, unknown>) {
      const row = { ...input, version: 0 };
      tables.set(table, [...(tables.get(table) ?? []), row]);
      return row;
    },
    async updateById(id: unknown, patch: Record<string, unknown>) {
      const row = tables.get(table)?.find((value) => value.id === id);
      if (row === undefined) throw new Error(`missing ${table}`);
      Object.assign(row, patch);
      return row;
    },
    async updateVersioned(id: unknown, _expectedVersion: number, patch: Record<string, unknown>) {
      const row = tables.get(table)?.find((value) => value.id === id || value.singleton_id === id);
      if (row === undefined) throw new Error(`missing ${table}`);
      Object.assign(row, patch, { version: Number(row.version ?? 0) + 1 });
      return row;
    },
  });
  const repositories = {
    ownerProfile: repository("ownerProfile"),
    ownerCredentials: repository("ownerProfile"),
    systemSettings: repository("systemSettings"),
    checkIns: repository("systemSettings"),
    checkinSchedules: repository("systemSettings"),
    contacts: repository("contacts"),
    shareGenerations: repository("shareGenerations"),
    contactKeyShares: repository("contactKeyShares"),
    vaults: repository("vaults"),
    workflows: repository("workflows"),
    packages: repository("packages"),
    idempotency: {} as never,
  } as unknown as TransactionContext["repositories"];
  const context = {
    repositories,
    clock: { now: async () => parseInstant("2026-08-08T14:00:00.000Z") },
    audit: { append: async () => undefined },
    outbox: { enqueue: async () => ({ id: "outbox" }) },
  } as unknown as TransactionContext;
  const transaction = {
    run: async <T>(work: (tx: TransactionContext) => Promise<T>) => work(context),
  };
  return { tables, transaction };
}

describe("share generation lifecycle", () => {
  it("calculates server-owned thresholds and binds an exact roster snapshot", async () => {
    const state = fixture();
    const result = await createShareGeneration(
      { ownerId: "owner-1", vaultId: "vault-1", contactSetVersion: 4, requestId: "request-1" },
      { transaction: state.transaction, idFactory: () => "generation-1" },
    );
    expect(result.contactCount).toBe(3);
    expect(result.deathThreshold).toBe(3);
    expect(result.recoveryThreshold).toBe(2);
    expect(result.contacts.map((contact) => contact.contactId)).toEqual([
      "contact-1",
      "contact-2",
      "contact-3",
    ]);
  });

  it("rejects stale roster and invalid proof, then stores an idempotent upload", async () => {
    const state = fixture();
    const draft = await createShareGeneration(
      { ownerId: "owner-1", vaultId: "vault-1", contactSetVersion: 4, requestId: "request-2" },
      { transaction: state.transaction, idFactory: () => "generation-2" },
    );
    const snapshot = Buffer.from(draft.contactsSnapshotSha256, "hex");
    const generationCommitment = new Uint8Array(32).fill(9);
    const vkCommitment = new Uint8Array(32).fill(7);
    const makeShares = () =>
      draft.contacts.map((contact, index) => ({
        contactId: contact.contactId,
        shareIndex: index + 1,
        deathShareCiphertext: new Uint8Array(48).fill(index + 10),
        recoveryShareCiphertext: new Uint8Array(48).fill(index + 20),
        deathShareCommitment: new Uint8Array(32).fill(index + 30),
        recoveryShareCommitment: new Uint8Array(32).fill(index + 40),
      }));
    await expect(
      uploadShareGeneration(
        {
          ownerId: "owner-1",
          generationId: "generation-2",
          contactSetVersion: 4,
          contactsSnapshotSha256: snapshot,
          protocolVersion: 1,
          vssScheme: "AUDITED_PUBLICLY_VERIFIABLE_SHARING_V1",
          generationCommitment,
          vkCommitment,
          generationProof: new Uint8Array(32),
          shares: makeShares(),
          requestId: "request-3",
        },
        { transaction: state.transaction, idFactory: () => "share-id" },
      ),
    ).rejects.toMatchObject({ code: "DLS-SHARE-INVALID" });
    const proof = generationProof({
      vaultId: "vault-1",
      generationId: "generation-2",
      contactsSnapshotSha256: snapshot,
      generationCommitment,
      vkCommitment,
    });
    const command = {
      ownerId: "owner-1",
      generationId: "generation-2",
      contactSetVersion: 4,
      contactsSnapshotSha256: snapshot,
      protocolVersion: 1,
      vssScheme: "AUDITED_PUBLICLY_VERIFIABLE_SHARING_V1",
      generationCommitment,
      vkCommitment,
      generationProof: proof,
      shares: makeShares(),
      requestId: "request-4",
    } as const;
    const uploaded = await uploadShareGeneration(command, {
      transaction: state.transaction,
      idFactory: () => "share-id",
    });
    expect(uploaded.uploadedShareCount).toBe(3);
    await expect(
      uploadShareGeneration(command, {
        transaction: state.transaction,
        idFactory: () => "share-id",
      }),
    ).resolves.toMatchObject({ uploadedShareCount: 3 });
  });

  it("activates one generation atomically and arms only when the package gate is ready", async () => {
    const state = fixture();
    const draft = await createShareGeneration(
      { ownerId: "owner-1", vaultId: "vault-1", contactSetVersion: 4, requestId: "request-5" },
      { transaction: state.transaction, idFactory: () => "generation-3" },
    );
    const snapshot = Buffer.from(draft.contactsSnapshotSha256, "hex");
    const generationCommitment = new Uint8Array(32).fill(9);
    const vkCommitment = new Uint8Array(32).fill(7);
    const proof = generationProof({
      vaultId: "vault-1",
      generationId: "generation-3",
      contactsSnapshotSha256: snapshot,
      generationCommitment,
      vkCommitment,
    });
    await uploadShareGeneration(
      {
        ownerId: "owner-1",
        generationId: "generation-3",
        contactSetVersion: 4,
        contactsSnapshotSha256: snapshot,
        protocolVersion: 1,
        vssScheme: "AUDITED_PUBLICLY_VERIFIABLE_SHARING_V1",
        generationCommitment,
        vkCommitment,
        generationProof: proof,
        shares: draft.contacts.map((contact, index) => ({
          contactId: contact.contactId,
          shareIndex: index + 1,
          deathShareCiphertext: new Uint8Array(48).fill(index + 1),
          recoveryShareCiphertext: new Uint8Array(48).fill(index + 4),
          deathShareCommitment: new Uint8Array(32).fill(index + 7),
          recoveryShareCommitment: new Uint8Array(32).fill(index + 10),
        })),
        requestId: "request-6",
      },
      { transaction: state.transaction, idFactory: () => "share-id" },
    );
    const result = await activateShareGeneration(
      {
        ownerId: "owner-1",
        generationId: "generation-3",
        contactSetVersion: 4,
        requestId: "request-7",
      },
      { transaction: state.transaction, idFactory: () => "activation-event" },
    );
    expect(result.status).toBe("ACTIVE");
    expect(result.systemState).toBe("ARMED");
    expect(state.tables.get("vaults")?.[0]?.active_share_generation_id).toBe("generation-3");
    expect(
      state.tables
        .get("contacts")
        ?.every((row) => row.active_share_generation_id === "generation-3"),
    ).toBe(true);
  });
});
