import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  advanceRelease,
  cancelDeathWorkflow,
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
const ownerScope = "release-lock-race-owner";
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
  return { workflowId, vaultId, contacts };
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
      await cleanupWorkflow(concurrencyPool, state.workflowId, state.vaultId, state.contacts);
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
      await cleanupWorkflow(concurrencyPool, state.workflowId, state.vaultId, state.contacts);
    }
  });
});
