import { parseInstant } from "@dls/domain";
import { describe, expect, it } from "vitest";
import type { IdempotencyRepository } from "../ports/idempotency.js";
import type { TransactionContext } from "../ports/transaction-manager.js";
import { createOwner, type OwnerSetupCommand } from "./create-owner.js";

const envelope = {
  ciphertext: "Y2lwaGVydGV4dA",
  nonce: "YWFhYWFhYWFhYWFh",
  kdfSalt: "YmJiYmJiYmJiYmJiYmJiYg",
  kdfParams: {
    algorithm: "argon2id" as const,
    memoryKiB: 65_536,
    iterations: 3,
    parallelism: 1,
    version: 19,
    purpose: "owner-vault-kek-v1" as const,
  },
  keyVerifierCiphertext: "dmVyaWZpZXI",
  keyVerifierNonce: "YWFhYWFhYWFhYWFh",
  vkCommitment: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  ownerEnvelopeProof: "cHJvb2Y",
};

const command: OwnerSetupCommand = {
  setupToken: "setup-secret",
  displayName: "张三",
  primaryEmail: "owner@example.com",
  backupEmail: "backup@example.com",
  password: "correct horse battery staple",
  ownerVaultEnvelope: envelope,
  requestId: "018f28a8-7f9a-7b32-9e41-4454f1c75691",
};

function dependencies() {
  const rows = new Map<string, Record<string, unknown>[]>();
  const inserted: string[] = [];
  const repository = (name: string) => ({
    async findById() {
      return rows.get(name)?.[0] === undefined ? null : { ...rows.get(name)?.[0], version: 0 };
    },
    async insert(input: Record<string, unknown>) {
      const list = rows.get(name) ?? [];
      list.push(input);
      rows.set(name, list);
      inserted.push(name);
      return { ...input, version: 0 };
    },
    async updateVersioned() {
      throw new Error("not used");
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
            reserve: async (key) => ({
              id: "00000000-0000-0000-0000-000000000098",
              actorScope: key.actorScope,
              commandName: key.commandName,
              keyDigest: key.keyDigest,
              requestHash: key.requestHash,
              status: "IN_PROGRESS",
            }),
            complete: async (id, responseStatus, responseBody) => ({
              id,
              actorScope: "test",
              commandName: "test",
              keyDigest: new Uint8Array(32),
              requestHash: new Uint8Array(32),
              status: "COMPLETED",
              responseStatus,
              responseBody,
            }),
          } satisfies IdempotencyRepository,
        },
        clock: { now: async () => parseInstant("2026-08-08T14:00:00.000Z") },
        outbox: {
          enqueue: async (event) => ({ ...event, id: "00000000-0000-0000-0000-000000000099" }),
        },
        audit: { append: async () => undefined },
      });
    },
  };
  return {
    rows,
    inserted,
    transaction,
    expectedSetupToken: "setup-secret",
    passwordHasher: async () => "$argon2id$v=19$m=65536,t=3,p=1$hash",
    protector: {
      protect: async (value: string) => ({
        ciphertext: new TextEncoder().encode(`cipher:${value}`),
        nonce: new Uint8Array(12),
        keyVersion: 1,
        lookupHmac: new Uint8Array(32),
      }),
    },
    idFactory: (() => {
      let index = 0;
      return () => `00000000-0000-0000-0000-00000000000${++index}`;
    })(),
  };
}

describe("createOwner", () => {
  it("creates the singleton owner and initial schedule atomically", async () => {
    const deps = dependencies();
    const result = await createOwner(command, deps);

    expect(result.ownerId).toMatch(/^[0-9a-f-]{36}$/);
    expect(deps.inserted).toEqual([
      "ownerProfile",
      "ownerCredentials",
      "systemSettings",
      "vaults",
      "checkIns",
      "checkinSchedules",
    ]);
    const owner = deps.rows.get("ownerProfile")?.[0];
    expect(owner?.primary_email_ciphertext).toBeInstanceOf(Uint8Array);
    expect(owner).not.toHaveProperty("password");
    expect(deps.rows.get("ownerCredentials")?.[0]?.password_phc).toMatch(/^\$argon2id\$/);
  });

  it("rejects an invalid or replayed setup capability before inserting state", async () => {
    const deps = dependencies();
    await expect(createOwner({ ...command, setupToken: "wrong" }, deps)).rejects.toMatchObject({
      code: "SETUP_INVALID",
    });
    expect(deps.inserted).toHaveLength(0);

    await createOwner(command, deps);
    await expect(createOwner(command, deps)).rejects.toMatchObject({
      code: "SETUP_ALREADY_COMPLETE",
    });
  });

  it("rejects malformed vault envelopes without exposing password material", async () => {
    const deps = dependencies();
    await expect(
      createOwner({ ...command, ownerVaultEnvelope: { ...envelope, vkCommitment: "bad" } }, deps),
    ).rejects.toMatchObject({ code: "SETUP_INVALID" });
    expect(JSON.stringify(deps.rows)).not.toContain(command.password);
  });
});
