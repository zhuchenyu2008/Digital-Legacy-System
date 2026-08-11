import { createHash } from "node:crypto";
import { parseInstant } from "@dls/domain";
import { describe, expect, it } from "vitest";
import { InMemorySessionStore, SessionService } from "../auth/session-service.js";
import { OWNER_ACTOR_ID } from "../owner/owner-identity.js";
import type { TransactionContext } from "../ports/transaction-manager.js";
import type { RecoveryCryptography } from "./approve-recovery.js";
import { approveRecovery } from "./approve-recovery.js";
import { completePasswordReset } from "./complete-password-reset.js";
import { createRewrapSession } from "./create-rewrap-session.js";
import { expireRecovery } from "./expire-recovery.js";
import { cancelActiveRecovery } from "./recovery-common.js";
import { requestRecovery } from "./request-recovery.js";
import { startRecovery } from "./start-recovery.js";

type Row = Record<string, unknown>;

function clone(row: Row): Row {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      value instanceof Uint8Array ? new Uint8Array(value) : value,
    ]),
  );
}

function fixture() {
  let now = parseInstant("2026-08-09T02:30:00.000Z");
  const contacts = [1, 2, 3].map((index) => ({
    id: `contact-${index}`,
    status: "ACTIVE",
    password_phc: `contact-hash-${index}`,
    x25519_public_key: new Uint8Array(32).fill(index),
    display_name_ciphertext: new Uint8Array([index]),
    display_name_nonce: new Uint8Array(12).fill(index),
    display_name_key_version: 1,
    email_ciphertext: new Uint8Array([index + 3]),
    email_nonce: new Uint8Array(12).fill(index + 3),
    email_key_version: 1,
    email_lookup_hmac: new Uint8Array(32).fill(index + 4),
    version: 0,
  }));
  const tables = new Map<string, Row[]>([
    [
      "ownerProfile",
      [
        {
          singleton_id: true,
          setup_state: "ARMED",
          display_name_ciphertext: new Uint8Array([1]),
          display_name_nonce: new Uint8Array(12),
          display_name_key_version: 1,
          primary_email_ciphertext: new Uint8Array([9]),
          primary_email_nonce: new Uint8Array(12).fill(9),
          primary_email_key_version: 1,
          backup_email_ciphertext: new Uint8Array([8]),
          version: 0,
        },
      ],
    ],
    ["ownerCredentials", [{ singleton_id: true, password_phc: "old-hash", version: 2 }]],
    ["systemSettings", [{ singleton_id: true, contact_set_version: 4, version: 0 }]],
    ["contacts", contacts],
    [
      "vaults",
      [
        {
          id: "vault-1",
          active_share_generation_id: "generation-1",
          vk_commitment: new Uint8Array(32).fill(7),
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
          generation_commitment: new Uint8Array(64).fill(6),
          version: 0,
        },
      ],
    ],
    [
      "contactKeyShares",
      contacts.map((contact, index) => ({
        id: `share-${index + 1}`,
        generation_id: "generation-1",
        contact_id: contact.id,
        share_index: index + 1,
        recovery_share_commitment: new Uint8Array(64).fill(5),
        version: 0,
      })),
    ],
    ["packages", [{ id: "package-1", status: "ACTIVE", version_no: 3, version: 0 }]],
    [
      "checkinSchedules",
      [
        {
          id: "schedule-1",
          status: "ACTIVE",
          schedule_version: 8,
          threshold_days: 3,
          deadline_at: "2026-08-12T16:00:00Z",
          version: 0,
        },
      ],
    ],
    ["checkIns", []],
    ["workflows", []],
    ["workflowContacts", []],
    ["workflowContactActions", []],
    ["workflowKeyFragments", []],
    ["recoverySecretSessions", []],
    ["passwordRewrapSessions", []],
    ["emailVerificationCodes", []],
    ["oneTimeTokens", []],
    ["authSessions", [{ id: "old-session", actor_type: "OWNER", revoked_at: null, version: 0 }]],
  ]);
  const repository = (table: string) => ({
    async findById(id: unknown) {
      return tables.get(table)?.find((row) => row.id === id || row.singleton_id === id) ?? null;
    },
    async findOneBy(field: string, value: unknown) {
      return (
        tables.get(table)?.find((row) => {
          const candidate = row[field];
          return candidate instanceof Uint8Array && value instanceof Uint8Array
            ? Buffer.from(candidate).equals(Buffer.from(value))
            : candidate === value;
        }) ?? null
      );
    },
    async findFirst() {
      return tables.get(table)?.[0] ?? null;
    },
    async findMany(field?: string, value?: unknown) {
      const rows = tables.get(table) ?? [];
      return field === undefined ? rows : rows.filter((row) => row[field] === value);
    },
    async insert(input: Row) {
      const row = { ...clone(input), version: Number(input.version ?? 0) };
      tables.set(table, [...(tables.get(table) ?? []), row]);
      return row;
    },
    async updateById(id: unknown, patch: Row) {
      const row = tables.get(table)?.find((candidate) => candidate.id === id);
      if (row === undefined) throw new Error(`missing ${table}`);
      Object.assign(row, clone(patch));
      return row;
    },
    async updateVersioned(id: unknown, expected: number, patch: Row) {
      const row = tables
        .get(table)
        ?.find((candidate) => candidate.id === id || candidate.singleton_id === id);
      if (row === undefined || Number(row.version) !== expected) throw new Error(`stale ${table}`);
      Object.assign(row, clone(patch), { version: expected + 1 });
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
    shareGenerations: repository("shareGenerations"),
    contactKeyShares: repository("contactKeyShares"),
    vaults: repository("vaults"),
    workflows: repository("workflows"),
    workflowContacts: repository("workflowContacts"),
    workflowContactActions: repository("workflowContactActions"),
    workflowKeyFragments: repository("workflowKeyFragments"),
    recoverySecretSessions: repository("recoverySecretSessions"),
    passwordRewrapSessions: repository("passwordRewrapSessions"),
    emailVerificationCodes: repository("emailVerificationCodes"),
    authSessions: repository("authSessions"),
    packages: repository("packages"),
    idempotency: {} as never,
  } as unknown as TransactionContext["repositories"];
  const outbox: Row[] = [];
  const context = {
    repositories,
    clock: { now: async () => now },
    audit: { append: async () => undefined },
    outbox: {
      enqueue: async (event: Row) => {
        outbox.push(clone(event));
        return { id: `outbox-${outbox.length}`, ...event };
      },
    },
  } as unknown as TransactionContext;
  const sessionService = new SessionService(new InMemorySessionStore(), {
    pepper: new Uint8Array(32).fill(11),
    clock: { now: () => now },
  });
  return {
    tables,
    outbox,
    sessionService,
    transaction: { run: async <T>(work: (tx: TransactionContext) => Promise<T>) => work(context) },
    setNow(value: string) {
      now = parseInstant(value);
    },
  };
}

const tokenPepper = new Uint8Array(32).fill(4);
const stageKeys = {
  ingressKeyPair: async () => ({
    version: 2,
    publicKey: new Uint8Array(32).fill(1),
    privateKey: new Uint8Array(32).fill(2),
  }),
  currentStageKey: async () => ({ version: 3, key: new Uint8Array(32).fill(3) }),
  stageKey: async () => ({ version: 3, key: new Uint8Array(32).fill(3) }),
};
const fragmentCryptography = {
  openIngress: async ({ context }: { context: { shareIndex: number } }) =>
    new Uint8Array(34).fill(context.shareIndex),
  verifyShare: async () => true,
  wrapStage: async ({ plaintextShare }: { plaintextShare: Uint8Array }) => ({
    protocolVersion: 1 as const,
    nonce: new Uint8Array(24).fill(3),
    ciphertext: new Uint8Array(plaintextShare),
  }),
};
const recoveryCryptography: RecoveryCryptography = {
  openStageShare: async ({ fragment }) => new Uint8Array(34).fill(Number(fragment.share_index)),
  verifyShare: async () => true,
  reconstruct: async () => new Uint8Array(32).fill(5),
  commitVaultKey: async () => new Uint8Array(32).fill(7),
  wrapRecoveryVaultKey: async () => ({
    protocolVersion: 1,
    nonce: new Uint8Array(24).fill(4),
    ciphertext: new Uint8Array(48).fill(5),
  }),
  openRecoveryVaultKey: async () => new Uint8Array(32).fill(5),
  sealVaultKey: async () => new Uint8Array(80).fill(6),
};

function fragment(contact: number) {
  const commitment = new Uint8Array(64).fill(5);
  return {
    generationId: "generation-1",
    shareIndex: contact,
    commitmentDigest: new Uint8Array(createHash("sha256").update(commitment).digest()),
    ingressKeyVersion: 2,
    protocolVersion: 1 as const,
    nonce: new Uint8Array(24).fill(contact),
    ciphertext: new Uint8Array(96).fill(contact + 8),
  };
}

async function start(state: ReturnType<typeof fixture>) {
  let challenge: Readonly<{ challengeId: string; token: string; expiresAt: string }> | undefined;
  await requestRecovery(
    { requestId: "00000000-0000-4000-8000-000000000001" },
    {
      transaction: state.transaction,
      tokenPepper,
      tokenFactory: () => new Uint8Array(32).fill(1),
      onPrimaryStartToken: async (value) => {
        challenge = value;
      },
    },
  );
  expect(challenge).toMatchObject({
    challengeId: expect.any(String),
    expiresAt: "2026-08-10T02:30:00Z",
  });
  if (challenge === undefined) throw new Error("recovery start challenge was not issued");
  const result = await startRecovery(
    { token: challenge.token, requestId: "00000000-0000-4000-8000-000000000002" },
    { transaction: state.transaction, tokenPepper, idFactory: () => "workflow-recovery" },
  );
  return { token: challenge.token, workflowId: result.workflowId };
}

async function reachThreshold(state: ReturnType<typeof fixture>) {
  const { workflowId } = await start(state);
  let resetToken = "";
  let code = "";
  let challengeWorkflowId = "";
  let challengeExpiresAt = "";
  for (const contact of [1, 2]) {
    await approveRecovery(
      {
        workflowId,
        contactId: `contact-${contact}`,
        password: `password-${contact}`,
        requestId: `00000000-0000-4000-8000-00000000000${contact + 2}`,
        fragment: fragment(contact),
      },
      {
        transaction: state.transaction,
        passwordVerifier: async (password, hash) =>
          password === `password-${contact}` && hash === `contact-hash-${contact}`,
        stageKeys,
        fragmentCryptography,
        recoveryCryptography,
        tokenPepper,
        tokenFactory: () => new Uint8Array(32).fill(2),
        codeFactory: () => "12345678",
        onPrimaryResetChallenge: async (challenge) => {
          resetToken = challenge.token;
          code = challenge.code;
          challengeWorkflowId = challenge.workflowId;
          challengeExpiresAt = challenge.expiresAt;
        },
      },
    );
  }
  return { workflowId, resetToken, code, challengeWorkflowId, challengeExpiresAt };
}

const replacementEnvelope = {
  ciphertext: Buffer.alloc(48, 1).toString("base64url"),
  nonce: Buffer.alloc(24, 2).toString("base64url"),
  kdfSalt: Buffer.alloc(16, 3).toString("base64url"),
  kdfParams: {
    algorithm: "argon2id" as const,
    memoryKiB: 65_536,
    iterations: 3,
    parallelism: 1,
    version: 19,
    purpose: "owner-vault-kek-v1" as const,
  },
  keyVerifierCiphertext: Buffer.alloc(48, 4).toString("base64url"),
  keyVerifierNonce: Buffer.alloc(24, 5).toString("base64url"),
  vkCommitment: Buffer.alloc(32, 7).toString("hex"),
  ownerEnvelopeProof: Buffer.alloc(32, 6).toString("base64url"),
};

describe("threshold owner password recovery", () => {
  it("returns one generic request response and starts one seven-day majority workflow", async () => {
    const state = fixture();
    const { token, workflowId } = await start(state);
    expect(token).not.toBe("");
    expect(state.tables.get("oneTimeTokens")?.[0]).not.toHaveProperty("token");
    expect(state.tables.get("workflows")?.[0]).toMatchObject({
      id: workflowId,
      kind: "PASSWORD_RECOVERY",
      state: "AWAITING_APPROVALS",
      contact_count_snapshot: 3,
      required_count_snapshot: 2,
      expires_at: "2026-08-16T02:30:00Z",
    });
    expect(state.outbox).toEqual([
      expect.objectContaining({
        eventType: "PASSWORD_RECOVERY_STARTED",
        aggregateId: workflowId,
        availableAt: "2026-08-16T02:30:00Z",
      }),
    ]);
  });

  it("requires contact password reauthentication and stages VK only at a valid threshold", async () => {
    const state = fixture();
    const { workflowId } = await start(state);
    await expect(
      approveRecovery(
        {
          workflowId,
          contactId: "contact-1",
          password: "wrong",
          requestId: "00000000-0000-4000-8000-000000000011",
          fragment: fragment(1),
        },
        {
          transaction: state.transaction,
          passwordVerifier: async () => false,
          stageKeys,
          fragmentCryptography,
          recoveryCryptography,
          tokenPepper,
        },
      ),
    ).rejects.toMatchObject({ code: "DLS-RECOVERY-REAUTH-REQUIRED", status: 401 });

    const reachedState = fixture();
    const reached = await reachThreshold(reachedState);
    expect(reached.code).toMatch(/^\d{8}$/u);
    expect(reached.challengeWorkflowId).toBe(reached.workflowId);
    expect(reached.challengeExpiresAt).toBe("2026-08-09T02:40:00Z");
    expect(reachedState.outbox.map((row) => row.eventType)).not.toContain(
      "PASSWORD_RECOVERY_THRESHOLD_REACHED",
    );
  });

  it("rejects mixed-generation and cryptographically invalid recovery shares", async () => {
    const state = fixture();
    const { workflowId } = await start(state);
    await expect(
      approveRecovery(
        {
          workflowId,
          contactId: "contact-1",
          password: "password-1",
          requestId: "00000000-0000-4000-8000-000000000012",
          fragment: { ...fragment(1), generationId: "mixed-generation" },
        },
        {
          transaction: state.transaction,
          passwordVerifier: async () => true,
          stageKeys,
          fragmentCryptography,
          recoveryCryptography,
          tokenPepper,
        },
      ),
    ).rejects.toMatchObject({ code: "DLS-RECOVERY-FRAGMENT-INVALID" });
    await expect(
      approveRecovery(
        {
          workflowId,
          contactId: "contact-1",
          password: "password-1",
          requestId: "00000000-0000-4000-8000-000000000013",
          fragment: fragment(1),
        },
        {
          transaction: state.transaction,
          passwordVerifier: async () => true,
          stageKeys,
          fragmentCryptography: { ...fragmentCryptography, verifyShare: async () => false },
          recoveryCryptography,
          tokenPepper,
        },
      ),
    ).rejects.toMatchObject({ code: "DLS-RECOVERY-FRAGMENT-INVALID" });
    expect(state.tables.get("workflowKeyFragments")).toHaveLength(0);
  });

  it("locks a ten-minute email challenge after five wrong codes", async () => {
    const state = fixture();
    const { resetToken } = await reachThreshold(state);
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await expect(
        createRewrapSession(
          {
            token: resetToken,
            emailVerificationCode: "00000000",
            clientEphemeralPublicKey: new Uint8Array(32).fill(9),
          },
          {
            transaction: state.transaction,
            tokenPepper,
            recoveryCryptography,
          },
        ),
      ).rejects.toMatchObject({ code: "DLS-RECOVERY-CHALLENGE-INVALID" });
      expect(state.tables.get("emailVerificationCodes")?.[0]?.attempt_count).toBe(attempt);
    }
    expect(state.tables.get("emailVerificationCodes")?.[0]?.locked_at).not.toBeNull();
  });

  it("creates one 15-minute ephemeral rewrap and atomically completes reset", async () => {
    const state = fixture();
    const { resetToken, code } = await reachThreshold(state);
    const material = await createRewrapSession(
      {
        token: resetToken,
        emailVerificationCode: code,
        clientEphemeralPublicKey: new Uint8Array(32).fill(9),
      },
      {
        transaction: state.transaction,
        tokenPepper,
        recoveryCryptography,
        resetSessionTokenFactory: () => new Uint8Array(32).fill(3),
      },
    );
    expect(material).toMatchObject({ workflowId: "workflow-recovery", vaultId: "vault-1" });
    expect(material.encryptedVaultKey).toHaveLength(80);
    expect(material.expiresAt).toBe("2026-08-09T02:45:00Z");
    expect(state.tables.get("passwordRewrapSessions")?.[0]).toMatchObject({ status: "ACTIVE" });

    const result = await completePasswordReset(
      {
        resetSessionToken: material.resetSessionToken,
        newPassword: "a-new-owner-password",
        newOwnerVaultEnvelope: replacementEnvelope,
        vaultKeyProof: Buffer.alloc(32, 8).toString("base64url"),
        requestId: "00000000-0000-4000-8000-000000000021",
      },
      {
        transaction: state.transaction,
        sessionService: state.sessionService,
        tokenPepper,
        recoveryCryptography,
        passwordHasher: async () => "new-auth-hash",
        replacementVerifier: async () => true,
      },
    );
    expect(result).toMatchObject({ completed: true, workflowState: "COMPLETED" });
    expect(state.tables.get("ownerCredentials")?.[0]).toMatchObject({
      password_phc: "new-auth-hash",
      version: 3,
    });
    expect(state.tables.get("authSessions")?.[0]?.revoked_at).not.toBeNull();
    expect(state.tables.get("recoverySecretSessions")?.[0]).toMatchObject({
      status: "DESTROYED",
      stage_key_envelope: null,
    });
    expect(state.tables.get("checkIns")).toHaveLength(1);
    expect(state.outbox.map((row) => row.eventType)).not.toContain("PASSWORD_RECOVERY_COMPLETED");
    await expect(
      completePasswordReset(
        {
          resetSessionToken: material.resetSessionToken,
          newPassword: "another-new-password",
          newOwnerVaultEnvelope: replacementEnvelope,
          vaultKeyProof: Buffer.alloc(32, 8).toString("base64url"),
          requestId: "00000000-0000-4000-8000-000000000022",
        },
        {
          transaction: state.transaction,
          sessionService: state.sessionService,
          tokenPepper,
          recoveryCryptography,
          passwordHasher: async () => "must-not-run",
          replacementVerifier: async () => true,
        },
      ),
    ).rejects.toMatchObject({ code: "DLS-RECOVERY-SESSION-INVALID" });
  });

  it("revokes all issued owner sessions after password recovery completes", async () => {
    const state = fixture();
    const sessionService = new SessionService(new InMemorySessionStore(), {
      pepper: new Uint8Array(32).fill(11),
    });
    const oldSession = await sessionService.create({
      actorType: "OWNER",
      actorId: OWNER_ACTOR_ID,
      credentialVersion: 2,
    });
    const { resetToken, code } = await reachThreshold(state);
    const material = await createRewrapSession(
      {
        token: resetToken,
        emailVerificationCode: code,
        clientEphemeralPublicKey: new Uint8Array(32).fill(9),
      },
      {
        transaction: state.transaction,
        tokenPepper,
        recoveryCryptography,
        resetSessionTokenFactory: () => new Uint8Array(32).fill(3),
      },
    );
    const dependencies = {
      transaction: state.transaction,
      tokenPepper,
      recoveryCryptography,
      passwordHasher: async () => "new-auth-hash",
      replacementVerifier: async () => true,
      sessionService,
    };

    await completePasswordReset(
      {
        resetSessionToken: material.resetSessionToken,
        newPassword: "a-new-owner-password",
        newOwnerVaultEnvelope: replacementEnvelope,
        vaultKeyProof: Buffer.alloc(32, 8).toString("base64url"),
        requestId: "00000000-0000-4000-8000-000000000023",
      },
      dependencies,
    );

    await expect(
      sessionService.authenticate(oldSession.token, {
        actorType: "OWNER",
        actorId: OWNER_ACTOR_ID,
      }),
    ).rejects.toMatchObject({ code: "SESSION_INVALID" });
  });

  it("expires after seven days without changing the check-in deadline", async () => {
    const state = fixture();
    const { workflowId } = await start(state);
    const deadline = state.tables.get("checkinSchedules")?.[0]?.deadline_at;
    state.setNow("2026-08-16T02:30:00.000Z");
    await expect(
      expireRecovery({ workflowId, aggregateVersion: 0 }, { transaction: state.transaction }),
    ).resolves.toMatchObject({ status: "EXPIRED" });
    expect(state.tables.get("workflows")?.[0]?.state).toBe("EXPIRED");
    expect(state.tables.get("checkinSchedules")?.[0]?.deadline_at).toBe(deadline);
    expect(state.outbox.map((row) => row.eventType)).not.toContain("PASSWORD_RECOVERY_EXPIRED");
  });

  it("expires at the fixed seven-day deadline even after approval versions advance", async () => {
    const state = fixture();
    const { workflowId } = await start(state);
    await approveRecovery(
      {
        workflowId,
        contactId: "contact-1",
        password: "password-1",
        requestId: "00000000-0000-4000-8000-000000000031",
        fragment: fragment(1),
      },
      {
        transaction: state.transaction,
        passwordVerifier: async () => true,
        stageKeys,
        fragmentCryptography,
        recoveryCryptography,
        tokenPepper,
      },
    );
    state.setNow("2026-08-16T02:30:00.000Z");

    await expect(
      expireRecovery({ workflowId, aggregateVersion: 0 }, { transaction: state.transaction }),
    ).resolves.toMatchObject({ status: "EXPIRED" });
    expect(state.tables.get("workflows")?.[0]).toMatchObject({ state: "EXPIRED", version: 2 });
  });

  it("destroys every staged artifact when valid owner authentication cancels recovery", async () => {
    const state = fixture();
    const { workflowId, resetToken, code } = await reachThreshold(state);
    await createRewrapSession(
      {
        token: resetToken,
        emailVerificationCode: code,
        clientEphemeralPublicKey: new Uint8Array(32).fill(9),
      },
      { transaction: state.transaction, tokenPepper, recoveryCryptography },
    );

    await state.transaction.run((tx) =>
      cancelActiveRecovery(tx, "2026-08-09T02:31:00Z", "OWNER_AUTHENTICATED"),
    );

    expect(state.tables.get("workflows")?.find((row) => row.id === workflowId)).toMatchObject({
      state: "CANCELLED",
      end_reason: "OWNER_AUTHENTICATED",
    });
    expect(state.tables.get("recoverySecretSessions")?.[0]).toMatchObject({
      status: "DESTROYED",
      stage_key_envelope: null,
    });
    expect(state.tables.get("passwordRewrapSessions")?.[0]).toMatchObject({
      status: "DESTROYED",
    });
  });
});
