import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  advanceRelease,
  aliveConfirmationText,
  cancelDeathWorkflow,
  confirmAlive,
  type StageKeyProvider,
  WorkflowError,
} from "../../packages/application/src/index.js";
import { PgTransactionManager } from "../../packages/persistence/src/postgres/index.js";
import {
  cleanupWorkflow,
  concurrencyPool,
  insertActiveGeneration,
  insertContacts,
  insertVault,
  insertWorkflow,
} from "./helpers.js";

const transaction = new PgTransactionManager(concurrencyPool);
const ownerScope = randomUUID();
const stageKeys: StageKeyProvider = {
  async ingressKeyPair() {
    return {
      version: 1,
      publicKey: new Uint8Array(32),
      privateKey: new Uint8Array(32),
    };
  },
  async currentStageKey() {
    return { version: 7, key: new Uint8Array(32).fill(7) };
  },
  async stageKey() {
    return { version: 7, key: new Uint8Array(32).fill(7) };
  },
};

async function ensureOwnerCredentials(): Promise<void> {
  await concurrencyPool.query(
    `INSERT INTO app.owner_profile (
       singleton_id, display_name_ciphertext, display_name_nonce, display_name_key_version,
       primary_email_ciphertext, primary_email_nonce, primary_email_key_version,
       primary_email_lookup_hmac, setup_state
     ) VALUES (
       true, decode('00', 'hex'), decode('00', 'hex'), 1,
       decode('00', 'hex'), decode('00', 'hex'), 1, digest($1, 'sha256'), 'ARMED'
     ) ON CONFLICT (singleton_id) DO NOTHING`,
    [`release-lock-race-${randomUUID()}@example.test`],
  );
  await concurrencyPool.query(
    `INSERT INTO app.owner_credentials (
       singleton_id, password_phc, password_changed_at, password_pepper_version,
       password_kdf_version, password_normalization_version
     ) VALUES (true, 'race-owner-hash', clock_timestamp(), 1, 1, 1)
     ON CONFLICT (singleton_id) DO NOTHING`,
  );
}

async function releaseFixture(releaseAtSql: string) {
  const vaultId = await insertVault(concurrencyPool);
  const contacts = await insertContacts(concurrencyPool, 3);
  const generationId = await insertActiveGeneration(concurrencyPool, vaultId, contacts.length);
  const workflowId = await insertWorkflow(
    concurrencyPool,
    vaultId,
    generationId,
    contacts,
    "RELEASE_PENDING",
    2,
  );
  await concurrencyPool.query(
    `UPDATE app.emergency_contacts
     SET status = 'ACTIVE', password_phc = 'contact-password-hash',
         password_changed_at = clock_timestamp(), password_pepper_version = 1,
         password_kdf_version = 1, password_normalization_version = 1,
         x25519_public_key = decode(repeat('03', 32), 'hex'),
         registered_at = clock_timestamp(), active_share_generation_id = $2
     WHERE id = ANY($1::uuid[])`,
    [contacts, generationId],
  );
  const checkInId = randomUUID();
  const scheduleId = randomUUID();
  const scheduleVersion = Date.now() * 1_000 + Math.floor(Math.random() * 1_000);
  await concurrencyPool.query(
    `INSERT INTO app.check_ins (id, beijing_date, checked_in_at, source, actor_type, request_id)
     VALUES ($1, CURRENT_DATE, clock_timestamp(), 'CONCURRENCY_TEST', 'OWNER', gen_random_uuid())`,
    [checkInId],
  );
  await concurrencyPool.query(
    `INSERT INTO app.checkin_schedules (
       id, schedule_version, last_check_in_id, threshold_days, deadline_at, status
     ) VALUES ($1, $2, $3, 30, clock_timestamp(), 'TRIGGERED')`,
    [scheduleId, scheduleVersion, checkInId],
  );
  await concurrencyPool.query(
    `UPDATE app.workflows
     SET release_at = ${releaseAtSql}, version = 0, publish_locked_at = NULL
     WHERE id = $1`,
    [workflowId],
  );
  await concurrencyPool.query(
    `INSERT INTO app.release_secret_sessions (
       workflow_id, stage_key_envelope, stage_key_nonce, stage_key_protocol_version,
       stage_key_version, status, expires_at
     ) VALUES ($1, decode(repeat('01', 48), 'hex'), decode(repeat('02', 24), 'hex'),
       1, 7, 'ACTIVE', clock_timestamp() + interval '24 hours')`,
    [workflowId],
  );
  return { workflowId, vaultId, contacts, scheduleId, checkInId };
}

async function cleanupReleaseFixture(state: Awaited<ReturnType<typeof releaseFixture>>) {
  await concurrencyPool.query("DELETE FROM app.checkin_schedules WHERE id = $1", [
    state.scheduleId,
  ]);
  await concurrencyPool.query("DELETE FROM app.check_ins WHERE workflow_id = $1 OR id = $2", [
    state.workflowId,
    state.checkInId,
  ]);
  await cleanupWorkflow(concurrencyPool, state.workflowId, state.vaultId, state.contacts);
}

async function race(workflowId: string) {
  const requests = Array.from({ length: 20 }, (_, index) =>
    index % 2 === 0
      ? cancelDeathWorkflow(
          {
            workflowId,
            ownerId: ownerScope,
            password: "correct-password",
            requestId: randomUUID(),
          },
          { transaction, passwordVerifier: async () => true },
        )
      : advanceRelease({ workflowId, aggregateVersion: 0 }, { transaction, stageKeys }),
  );
  return Promise.allSettled(requests);
}

function errorSummary(value: unknown) {
  const error = value as {
    name?: unknown;
    code?: unknown;
    message?: unknown;
    cause?: { code?: unknown; message?: unknown; constraint?: unknown };
  };
  return {
    name: error.name,
    code: error.code,
    message: error.message,
    causeCode: error.cause?.code,
    causeMessage: error.cause?.message,
    constraint: error.cause?.constraint,
  };
}

describe("owner cancellation and irreversible release-lock races", () => {
  beforeAll(ensureOwnerCredentials);

  afterAll(async () => {
    await concurrencyPool.query("DELETE FROM app.idempotency_records WHERE actor_scope = $1", [
      `OWNER:${ownerScope}`,
    ]);
    await concurrencyPool.end();
  });

  it("commits one publish lock when twenty cancel/finalize requests race at the deadline", async () => {
    const state = await releaseFixture("clock_timestamp()");
    try {
      const settled = await race(state.workflowId);
      const unexpected = settled.flatMap((result) =>
        result.status === "rejected" && !(result.reason instanceof WorkflowError)
          ? [errorSummary(result.reason)]
          : [],
      );
      expect(unexpected).toEqual([]);
      for (const result of settled) {
        if (result.status === "rejected") {
          expect(result.reason).toBeInstanceOf(WorkflowError);
          expect(result.reason).toMatchObject({ code: "DLS-RELEASE-LOCKED" });
        }
      }
      const workflow = await concurrencyPool.query(
        "SELECT state, publish_locked_at, version FROM app.workflows WHERE id = $1",
        [state.workflowId],
      );
      const events = await concurrencyPool.query(
        `SELECT event_type FROM app.domain_outbox
         WHERE aggregate_id = $1 AND event_type IN (
           'PUBLICATION_FINALIZE_REQUESTED', 'DEATH_WORKFLOW_CANCELLED'
         )`,
        [state.workflowId],
      );
      expect(workflow.rows[0]).toMatchObject({ state: "RELEASE_PENDING", version: "1" });
      expect(workflow.rows[0].publish_locked_at).not.toBeNull();
      expect(events.rows).toEqual([{ event_type: "PUBLICATION_FINALIZE_REQUESTED" }]);
    } finally {
      await cleanupReleaseFixture(state);
    }
  });

  it("commits one cancellation and no publish lock when the same race is before deadline", async () => {
    const state = await releaseFixture("clock_timestamp() + interval '1 hour'");
    try {
      const settled = await race(state.workflowId);
      expect(
        settled.flatMap((result) =>
          result.status === "rejected" ? [errorSummary(result.reason)] : [],
        ),
      ).toEqual([]);
      const workflow = await concurrencyPool.query(
        "SELECT state, publish_locked_at, version FROM app.workflows WHERE id = $1",
        [state.workflowId],
      );
      const session = await concurrencyPool.query(
        `SELECT status, stage_key_envelope, stage_key_nonce
         FROM app.release_secret_sessions WHERE workflow_id = $1`,
        [state.workflowId],
      );
      const events = await concurrencyPool.query(
        `SELECT event_type FROM app.domain_outbox
         WHERE aggregate_id = $1 AND event_type IN (
           'PUBLICATION_FINALIZE_REQUESTED', 'DEATH_WORKFLOW_CANCELLED'
         )`,
        [state.workflowId],
      );
      expect(workflow.rows[0]).toMatchObject({
        state: "CANCELLED",
        publish_locked_at: null,
        version: "1",
      });
      expect(session.rows[0]).toMatchObject({
        status: "DESTROYED",
        stage_key_envelope: null,
        stage_key_nonce: null,
      });
      expect(events.rows).toEqual([{ event_type: "DEATH_WORKFLOW_CANCELLED" }]);
    } finally {
      await cleanupReleaseFixture(state);
    }
  });

  it("makes a contact veto and the formal publish lock mutually exclusive at the deadline", async () => {
    const state = await releaseFixture("clock_timestamp()");
    const contactScopes = state.contacts.map((contactId) => `CONTACT:${contactId}`);
    try {
      const requests = Array.from({ length: 24 }, (_, index) => {
        if (index % 2 === 0) {
          const contactId = state.contacts[index % state.contacts.length] as string;
          return confirmAlive(
            {
              workflowId: state.workflowId,
              contactId,
              password: "correct-contact-password",
              confirmationText: aliveConfirmationText("测试主人"),
              requestId: randomUUID(),
            },
            {
              transaction,
              passwordVerifier: async () => true,
              ownerDisplayName: async () => "测试主人",
            },
          );
        }
        return advanceRelease(
          { workflowId: state.workflowId, aggregateVersion: 0 },
          { transaction, stageKeys },
        );
      });
      const settled = await Promise.allSettled(requests);
      const successfulVetoes = settled.filter(
        (result) => result.status === "fulfilled" && "cancelled" in result.value,
      );
      const workflow = await concurrencyPool.query(
        "SELECT state, publish_locked_at FROM app.workflows WHERE id = $1",
        [state.workflowId],
      );
      const events = await concurrencyPool.query(
        `SELECT event_type FROM app.domain_outbox
         WHERE aggregate_id = $1
           AND event_type IN ('PUBLICATION_FINALIZE_REQUESTED', 'DEATH_CANCELLED_BY_CONTACT')
         ORDER BY event_type`,
        [state.workflowId],
      );
      if (successfulVetoes.length > 0) {
        expect(successfulVetoes).toHaveLength(1);
        expect(workflow.rows[0]).toMatchObject({ state: "CANCELLED", publish_locked_at: null });
        expect(events.rows).toEqual([{ event_type: "DEATH_CANCELLED_BY_CONTACT" }]);
      } else {
        expect(workflow.rows[0].state).toBe("RELEASE_PENDING");
        expect(workflow.rows[0].publish_locked_at).not.toBeNull();
        expect(events.rows).toEqual([{ event_type: "PUBLICATION_FINALIZE_REQUESTED" }]);
        for (const result of settled) {
          if (result.status === "rejected" && result.reason instanceof WorkflowError) {
            expect(["DLS-RELEASE-LOCKED", "DLS-CONTACT-ACTION-CLOSED"]).toContain(
              result.reason.code,
            );
          }
        }
      }
    } finally {
      await concurrencyPool.query(
        "DELETE FROM app.idempotency_records WHERE actor_scope = ANY($1::text[])",
        [contactScopes],
      );
      await cleanupReleaseFixture(state);
    }
  });
});
