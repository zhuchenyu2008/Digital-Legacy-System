import { createHash, createHmac, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import {
  approveRecovery,
  completePasswordReset,
  type RecoveryCryptography,
  RecoveryError,
  startDeathWorkflow,
  type TransactionContext,
  type TransactionManager,
} from "../../packages/application/src/index.js";
import { PgTransactionManager } from "../../packages/persistence/src/postgres/index.js";
import {
  concurrencyPool,
  insertActiveGeneration,
  insertContacts,
  insertVault,
  insertWorkflow,
} from "./helpers.js";

const tokenPepper = new Uint8Array(32).fill(4);

function synchronizedManagers(pool: Pool): readonly [TransactionManager, TransactionManager] {
  let ready = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const create = (): TransactionManager => ({
    async run<T>(
      work: (tx: TransactionContext) => Promise<T>,
      options?: { isolation?: "read committed" | "serializable" },
    ): Promise<T> {
      ready += 1;
      if (ready === 2) release();
      await gate;
      return new PgTransactionManager(pool).run(work, options);
    },
  });
  return [create(), create()];
}

type Fixture = Readonly<{
  vaultId: string;
  generationId: string;
  recoveryWorkflowId: string;
  deathWorkflowId: string;
  scheduleId: string;
  scheduleVersion: number;
  checkInId: string;
  contacts: readonly string[];
  packageId: string;
}>;

async function fixture(state: "AWAITING_APPROVALS" | "REWRAP_PENDING"): Promise<Fixture> {
  const vaultId = await insertVault(concurrencyPool);
  const contacts = await insertContacts(concurrencyPool, 3);
  const generationId = await insertActiveGeneration(concurrencyPool, vaultId, contacts.length);
  await concurrencyPool.query("UPDATE app.vaults SET vk_commitment = $2 WHERE id = $1", [
    vaultId,
    Buffer.alloc(32, 7),
  ]);
  await concurrencyPool.query(
    "UPDATE app.share_generations SET generation_commitment = $2 WHERE id = $1",
    [generationId, Buffer.alloc(64, 8)],
  );
  const recoveryWorkflowId = await insertWorkflow(
    concurrencyPool,
    vaultId,
    generationId,
    contacts,
    state,
    2,
  );
  await concurrencyPool.query(
    `UPDATE app.workflows
     SET kind = 'PASSWORD_RECOVERY', expires_at = clock_timestamp() + interval '7 days'
     WHERE id = $1`,
    [recoveryWorkflowId],
  );
  const workflow = await concurrencyPool.query(
    "SELECT package_id FROM app.workflows WHERE id = $1",
    [recoveryWorkflowId],
  );
  const packageId = workflow.rows[0].package_id as string;
  await concurrencyPool.query(
    `INSERT INTO app.owner_profile (
       singleton_id, display_name_ciphertext, display_name_nonce, display_name_key_version,
       primary_email_ciphertext, primary_email_nonce, primary_email_key_version,
       primary_email_lookup_hmac, setup_state, irreversibility_accepted_at
     ) VALUES (true, decode('01', 'hex'), decode('02', 'hex'), 1, decode('03', 'hex'),
       decode('04', 'hex'), 1, digest($1, 'sha256'), 'ARMED', clock_timestamp())
     ON CONFLICT (singleton_id) DO UPDATE SET setup_state = 'ARMED',
       irreversibility_accepted_at = EXCLUDED.irreversibility_accepted_at`,
    [`race-${randomUUID()}@example.test`],
  );
  await concurrencyPool.query(
    `INSERT INTO app.owner_credentials (
       singleton_id, password_phc, password_changed_at, password_pepper_version,
       password_kdf_version, password_normalization_version
     ) VALUES (true, 'old-owner-hash', clock_timestamp(), 1, 1, 1)
     ON CONFLICT (singleton_id) DO UPDATE SET password_phc = 'old-owner-hash',
       credential_version = 0, password_changed_at = clock_timestamp()`,
  );
  await concurrencyPool.query(
    `INSERT INTO app.system_settings (
       singleton_id, timezone, missed_days_threshold, contact_consent_version,
       contact_consent_sha256, public_base_url, contact_set_version
     ) VALUES (true, 'Asia/Shanghai', 3, 'race-v1', digest('race', 'sha256'),
       'http://localhost:3000', 1)
     ON CONFLICT (singleton_id) DO UPDATE SET contact_set_version = 1`,
  );
  for (const [index, contactId] of contacts.entries()) {
    await concurrencyPool.query(
      `UPDATE app.emergency_contacts SET status = 'ACTIVE', password_phc = $2,
         password_changed_at = clock_timestamp(), password_pepper_version = 1,
         password_kdf_version = 1, password_normalization_version = 1,
         x25519_public_key = $3, registered_at = clock_timestamp(),
         active_share_generation_id = $4
       WHERE id = $1`,
      [contactId, `contact-hash-${index + 1}`, Buffer.alloc(32, 9 + index), generationId],
    );
    await concurrencyPool.query(
      `INSERT INTO app.contact_key_shares (
         generation_id, contact_id, share_index, death_share_ciphertext,
         recovery_share_ciphertext, share_protocol_version, death_share_commitment,
         recovery_share_commitment
       ) VALUES ($1, $2, $3, $4, $5, 1, $6, $7)`,
      [
        generationId,
        contactId,
        index + 1,
        Buffer.alloc(48, 20 + index),
        Buffer.alloc(48, 30 + index),
        Buffer.alloc(64, 9),
        Buffer.alloc(64, 8),
      ],
    );
  }
  const checkInId = randomUUID();
  const scheduleId = randomUUID();
  const version = await concurrencyPool.query(
    "SELECT COALESCE(MAX(schedule_version), 0)::bigint + 1 AS version FROM app.checkin_schedules",
  );
  const scheduleVersion = Number(version.rows[0].version);
  await concurrencyPool.query(
    `INSERT INTO app.check_ins (id, beijing_date, checked_in_at, source, actor_type, request_id)
     VALUES ($1, DATE '2026-07-01', clock_timestamp() - interval '30 days',
       'TEST', 'OWNER', gen_random_uuid())`,
    [checkInId],
  );
  await concurrencyPool.query(
    `INSERT INTO app.checkin_schedules (
       id, schedule_version, last_check_in_id, threshold_days, deadline_at, status
     ) VALUES ($1, $2, $3, 3, clock_timestamp() - interval '1 second', 'TRIGGERED')`,
    [scheduleId, scheduleVersion, checkInId],
  );
  if (state === "REWRAP_PENDING") {
    const resetSessionToken = "race-reset-session";
    await concurrencyPool.query(
      `INSERT INTO app.recovery_secret_sessions (
         workflow_id, stage_key_envelope, stage_key_nonce, stage_key_protocol_version,
         stage_key_version, vault_key_commitment, status, expires_at
       ) VALUES ($1, $2, $3, 1, 3, $4, 'ACTIVE', clock_timestamp() + interval '1 hour')`,
      [recoveryWorkflowId, Buffer.alloc(48, 5), Buffer.alloc(24, 4), Buffer.alloc(32, 7)],
    );
    await concurrencyPool.query(
      `INSERT INTO app.password_rewrap_sessions (
         workflow_id, replacement_owner_envelope, replacement_envelope_nonce,
         replacement_envelope_protocol_version, reset_token_hash, token_hmac_key_version,
         client_ephemeral_public_key, sealed_vault_key_digest, status, expires_at
       ) VALUES ($1, NULL, NULL, NULL, $2, 1, $3, $4, 'ACTIVE',
         clock_timestamp() + interval '15 minutes')`,
      [
        recoveryWorkflowId,
        createHmac("sha256", tokenPepper).update(resetSessionToken).digest(),
        Buffer.alloc(32, 9),
        Buffer.alloc(32, 6),
      ],
    );
  }
  return {
    vaultId,
    generationId,
    recoveryWorkflowId,
    deathWorkflowId: randomUUID(),
    scheduleId,
    scheduleVersion,
    checkInId,
    contacts,
    packageId,
  };
}

async function cleanup(state: Fixture): Promise<void> {
  const workflows = await concurrencyPool.query(
    "SELECT id FROM app.workflows WHERE share_generation_id = $1",
    [state.generationId],
  );
  const workflowIds = workflows.rows.map((row) => row.id as string);
  if (workflowIds.length > 0) {
    await concurrencyPool.query(
      "DELETE FROM app.domain_outbox WHERE aggregate_id = ANY($1::uuid[])",
      [workflowIds],
    );
    await concurrencyPool.query(
      `DELETE FROM app.checkin_schedules
       WHERE last_check_in_id IN (
         SELECT id FROM app.check_ins WHERE workflow_id = ANY($1::uuid[])
       )`,
      [workflowIds],
    );
    await concurrencyPool.query("DELETE FROM app.check_ins WHERE workflow_id = ANY($1::uuid[])", [
      workflowIds,
    ]);
    await concurrencyPool.query(
      "DELETE FROM app.email_verification_codes WHERE workflow_id = ANY($1::uuid[])",
      [workflowIds],
    );
    await concurrencyPool.query(
      "DELETE FROM app.password_rewrap_sessions WHERE workflow_id = ANY($1::uuid[])",
      [workflowIds],
    );
    await concurrencyPool.query(
      "DELETE FROM app.recovery_secret_sessions WHERE workflow_id = ANY($1::uuid[])",
      [workflowIds],
    );
    await concurrencyPool.query(
      "DELETE FROM app.one_time_tokens WHERE subject_id = ANY($1::uuid[])",
      [workflowIds],
    );
    await concurrencyPool.query(
      "DELETE FROM app.workflow_key_fragments WHERE workflow_id = ANY($1::uuid[])",
      [workflowIds],
    );
    await concurrencyPool.query(
      "DELETE FROM app.workflow_contact_actions WHERE workflow_id = ANY($1::uuid[])",
      [workflowIds],
    );
    await concurrencyPool.query(
      "DELETE FROM app.workflow_contacts WHERE workflow_id = ANY($1::uuid[])",
      [workflowIds],
    );
    await concurrencyPool.query("DELETE FROM app.workflows WHERE id = ANY($1::uuid[])", [
      workflowIds,
    ]);
  }
  await concurrencyPool.query("DELETE FROM app.checkin_schedules WHERE id = $1", [
    state.scheduleId,
  ]);
  await concurrencyPool.query("DELETE FROM app.check_ins WHERE id = $1", [state.checkInId]);
  await concurrencyPool.query("DELETE FROM app.contact_key_shares WHERE generation_id = $1", [
    state.generationId,
  ]);
  await concurrencyPool.query("DELETE FROM app.emergency_contacts WHERE id = ANY($1::uuid[])", [
    state.contacts,
  ]);
  await concurrencyPool.query(
    "UPDATE app.vaults SET active_share_generation_id = NULL WHERE id = $1",
    [state.vaultId],
  );
  await concurrencyPool.query("DELETE FROM app.legacy_packages WHERE id = $1", [state.packageId]);
  await concurrencyPool.query("DELETE FROM app.share_generations WHERE id = $1", [
    state.generationId,
  ]);
  await concurrencyPool.query("DELETE FROM app.vaults WHERE id = $1", [state.vaultId]);
}

const stageKeys = {
  ingressKeyPair: async () => ({
    version: 2,
    publicKey: new Uint8Array(32).fill(1),
    privateKey: new Uint8Array(32).fill(2),
  }),
  currentStageKey: async () => ({ version: 3, key: new Uint8Array(32).fill(3) }),
  stageKey: async () => ({ version: 3, key: new Uint8Array(32).fill(3) }),
};

const recoveryCryptography: RecoveryCryptography = {
  openStageShare: async () => new Uint8Array(34).fill(1),
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

describe("password recovery and death-start races", () => {
  afterAll(async () => {
    await concurrencyPool.end();
  });

  it("lets death start cancel an approval and destroys any fragment that committed first", async () => {
    const state = await fixture("AWAITING_APPROVALS");
    const [approvalTransaction, deathTransaction] = synchronizedManagers(concurrencyPool);
    try {
      const commitment = Buffer.alloc(64, 8);
      const results = await Promise.allSettled([
        approveRecovery(
          {
            workflowId: state.recoveryWorkflowId,
            contactId: state.contacts[0] as string,
            password: "correct",
            requestId: randomUUID(),
            fragment: {
              generationId: state.generationId,
              shareIndex: 1,
              commitmentDigest: new Uint8Array(createHash("sha256").update(commitment).digest()),
              ingressKeyVersion: 2,
              protocolVersion: 1,
              nonce: new Uint8Array(24).fill(1),
              ciphertext: new Uint8Array(96).fill(2),
            },
          },
          {
            transaction: approvalTransaction,
            passwordVerifier: async () => true,
            stageKeys,
            fragmentCryptography: {
              openIngress: async () => new Uint8Array(34).fill(1),
              verifyShare: async () => true,
              wrapStage: async () => ({
                protocolVersion: 1,
                nonce: new Uint8Array(24).fill(3),
                ciphertext: new Uint8Array(50).fill(4),
              }),
            },
            recoveryCryptography,
            tokenPepper,
            idFactory: () => randomUUID(),
          },
        ),
        startDeathWorkflow(
          { scheduleId: state.scheduleId, scheduleVersion: state.scheduleVersion },
          { transaction: deathTransaction, idFactory: () => state.deathWorkflowId },
        ),
      ]);
      const unexpected = results.filter(
        (result) => result.status === "rejected" && !(result.reason instanceof RecoveryError),
      );
      expect(unexpected).toEqual([]);
      expect(results[1]).toMatchObject({ status: "fulfilled", value: { status: "STARTED" } });
      const recovery = await concurrencyPool.query(
        "SELECT state, end_reason FROM app.workflows WHERE id = $1",
        [state.recoveryWorkflowId],
      );
      const death = await concurrencyPool.query("SELECT state FROM app.workflows WHERE id = $1", [
        state.deathWorkflowId,
      ]);
      const fragments = await concurrencyPool.query(
        `SELECT status, fragment_ciphertext, fragment_nonce
         FROM app.workflow_key_fragments WHERE workflow_id = $1`,
        [state.recoveryWorkflowId],
      );
      expect(recovery.rows[0]).toMatchObject({
        state: "CANCELLED",
        end_reason: "DEATH_WORKFLOW_PRIORITY",
      });
      expect(death.rows[0]).toMatchObject({ state: "AWAITING_CONFIRMATIONS" });
      expect(
        fragments.rows.every(
          (row) =>
            row.status === "DESTROYED" &&
            row.fragment_ciphertext === null &&
            row.fragment_nonce === null,
        ),
      ).toBe(true);
    } finally {
      await cleanup(state);
    }
  });

  it("commits exactly one of password-reset completion or death start", async () => {
    const state = await fixture("REWRAP_PENDING");
    const [completionTransaction, deathTransaction] = synchronizedManagers(concurrencyPool);
    try {
      const results = await Promise.allSettled([
        completePasswordReset(
          {
            resetSessionToken: "race-reset-session",
            newPassword: "a-new-owner-password",
            newOwnerVaultEnvelope: replacementEnvelope,
            vaultKeyProof: Buffer.alloc(32, 8).toString("base64url"),
            requestId: randomUUID(),
          },
          {
            transaction: completionTransaction,
            tokenPepper,
            recoveryCryptography,
            passwordHasher: async () => "new-owner-hash",
            replacementVerifier: async () => true,
          },
        ),
        startDeathWorkflow(
          { scheduleId: state.scheduleId, scheduleVersion: state.scheduleVersion },
          { transaction: deathTransaction, idFactory: () => state.deathWorkflowId },
        ),
      ]);
      const completionWon = results[0].status === "fulfilled";
      const deathWon = results[1].status === "fulfilled" && results[1].value.status === "STARTED";
      expect(Number(completionWon) + Number(deathWon)).toBe(1);
      if (results[0].status === "rejected") {
        expect(results[0].reason).toBeInstanceOf(RecoveryError);
      }
      const recovery = await concurrencyPool.query(
        "SELECT state, end_reason FROM app.workflows WHERE id = $1",
        [state.recoveryWorkflowId],
      );
      const secret = await concurrencyPool.query(
        `SELECT status, stage_key_envelope, stage_key_nonce
         FROM app.recovery_secret_sessions WHERE workflow_id = $1`,
        [state.recoveryWorkflowId],
      );
      if (completionWon) {
        expect(results[1]).toMatchObject({ status: "fulfilled", value: { status: "STALE" } });
        expect(recovery.rows[0]).toMatchObject({
          state: "COMPLETED",
          end_reason: "PASSWORD_RESET_COMPLETED",
        });
      } else {
        expect(recovery.rows[0]).toMatchObject({
          state: "CANCELLED",
          end_reason: "DEATH_WORKFLOW_PRIORITY",
        });
      }
      expect(secret.rows[0]).toMatchObject({
        status: "DESTROYED",
        stage_key_envelope: null,
        stage_key_nonce: null,
      });
    } finally {
      await cleanup(state);
    }
  });
});
