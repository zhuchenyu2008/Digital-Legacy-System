import { afterAll, describe, expect, it } from "vitest";
import {
  cleanupWorkflow,
  concurrencyPool,
  insertActiveGeneration,
  insertContacts,
  insertVault,
  insertWorkflow,
  inTransaction,
  runSynchronized,
} from "./helpers.js";

describe("contact decision races", () => {
  afterAll(async () => {
    await concurrencyPool.end();
  });

  it("advances the snapshotted threshold once under twenty simultaneous affirmatives", async () => {
    const vaultId = await insertVault(concurrencyPool);
    const contacts = await insertContacts(concurrencyPool, 20);
    const generationId = await insertActiveGeneration(concurrencyPool, vaultId, contacts.length);
    const workflowId = await insertWorkflow(
      concurrencyPool,
      vaultId,
      generationId,
      contacts,
      "AWAITING_CONFIRMATIONS",
      3,
    );
    try {
      await runSynchronized(concurrencyPool, 20, (client, index) =>
        inTransaction(client, async () => {
          const locked = await client.query(
            "SELECT state, version, required_count_snapshot FROM app.workflows WHERE id = $1 FOR UPDATE",
            [workflowId],
          );
          const workflow = locked.rows[0];
          if (workflow.state !== "AWAITING_CONFIRMATIONS") return;
          await client.query(
            `INSERT INTO app.workflow_contact_actions (
               workflow_id, contact_id, decision, decision_digest
             ) VALUES ($1, $2, 'DEATH_LIKELY', digest($3, 'sha256'))`,
            [workflowId, contacts[index], `affirmative-${index}`],
          );
          const count = await client.query(
            `SELECT count(*)::int AS count
             FROM app.workflow_contact_actions
             WHERE workflow_id = $1 AND decision = 'DEATH_LIKELY'`,
            [workflowId],
          );
          const approved = Number(count.rows[0].count);
          const thresholdReached = approved >= Number(workflow.required_count_snapshot);
          await client.query(
            `UPDATE app.workflows
             SET approved_count = $2,
                 state = CASE WHEN $3 THEN 'RELEASE_PENDING'::app.workflow_state ELSE state END,
                 release_at = CASE WHEN $3 THEN clock_timestamp() + interval '24 hours' ELSE release_at END,
                 version = version + 1,
                 updated_at = clock_timestamp()
             WHERE id = $1`,
            [workflowId, approved, thresholdReached],
          );
          if (thresholdReached) {
            await client.query(
              `INSERT INTO app.release_secret_sessions (
                 workflow_id, stage_key_envelope, stage_key_nonce, stage_key_protocol_version,
                 stage_key_version, status, expires_at
               ) VALUES ($1, decode('01', 'hex'), decode('02', 'hex'), 1, 1, 'ACTIVE',
                 clock_timestamp() + interval '24 hours')`,
              [workflowId],
            );
          }
          await client.query(
            `INSERT INTO app.domain_outbox (
               event_type, aggregate_type, aggregate_id, payload, idempotency_key
             ) VALUES ('DEATH_CONFIRMATION_RECORDED', 'workflow', $1::uuid,
               jsonb_build_object('aggregateId', ($1::uuid)::text, 'aggregateVersion', $2::int), $3)`,
            [workflowId, Number(workflow.version) + 1, `${workflowId}:${index}`],
          );
        }),
      );

      const workflow = await concurrencyPool.query(
        "SELECT state, approved_count, version FROM app.workflows WHERE id = $1",
        [workflowId],
      );
      const actions = await concurrencyPool.query(
        "SELECT count(*)::int AS count FROM app.workflow_contact_actions WHERE workflow_id = $1",
        [workflowId],
      );
      const sessions = await concurrencyPool.query(
        "SELECT count(*)::int AS count FROM app.release_secret_sessions WHERE workflow_id = $1",
        [workflowId],
      );
      expect(workflow.rows[0]).toMatchObject({
        state: "RELEASE_PENDING",
        approved_count: 3,
        version: "3",
      });
      expect(actions.rows[0].count).toBe(3);
      expect(sessions.rows[0].count).toBe(1);
    } finally {
      await cleanupWorkflow(concurrencyPool, workflowId, vaultId, contacts);
    }
  });

  it("persists only one final decision when the same contact races alive and affirmative", async () => {
    const vaultId = await insertVault(concurrencyPool);
    const contacts = await insertContacts(concurrencyPool, 3);
    const generationId = await insertActiveGeneration(concurrencyPool, vaultId, contacts.length);
    const workflowId = await insertWorkflow(
      concurrencyPool,
      vaultId,
      generationId,
      contacts,
      "AWAITING_CONFIRMATIONS",
      3,
    );
    try {
      await runSynchronized(concurrencyPool, 20, (client, index) =>
        inTransaction(client, async () => {
          const locked = await client.query(
            "SELECT state FROM app.workflows WHERE id = $1 FOR UPDATE",
            [workflowId],
          );
          if (locked.rows[0].state !== "AWAITING_CONFIRMATIONS") return;
          const decision = index % 2 === 0 ? "ALIVE" : "DEATH_LIKELY";
          const inserted = await client.query(
            `INSERT INTO app.workflow_contact_actions (
               workflow_id, contact_id, decision, decision_digest
             ) VALUES ($1, $2, $3::app.workflow_decision,
               digest(($3::app.workflow_decision)::text, 'sha256'))
             ON CONFLICT (workflow_id, contact_id) DO NOTHING
             RETURNING decision`,
            [workflowId, contacts[0], decision],
          );
          if (inserted.rowCount !== 1) return;
          await client.query(
            `UPDATE app.workflows
             SET state = CASE WHEN $2 = 'ALIVE' THEN 'CANCELLED'::app.workflow_state ELSE state END,
                 approved_count = CASE WHEN $2 = 'DEATH_LIKELY' THEN 1 ELSE approved_count END,
                 ended_at = CASE WHEN $2 = 'ALIVE' THEN clock_timestamp() ELSE ended_at END,
                 end_reason = CASE WHEN $2 = 'ALIVE' THEN 'CONTACT_CONFIRMED_ALIVE' ELSE end_reason END,
                 version = version + 1
             WHERE id = $1`,
            [workflowId, decision],
          );
        }),
      );

      const actions = await concurrencyPool.query(
        "SELECT decision FROM app.workflow_contact_actions WHERE workflow_id = $1",
        [workflowId],
      );
      const workflow = await concurrencyPool.query(
        "SELECT state, approved_count, version FROM app.workflows WHERE id = $1",
        [workflowId],
      );
      expect(actions.rows).toHaveLength(1);
      expect(["ALIVE", "DEATH_LIKELY"]).toContain(actions.rows[0].decision);
      expect(workflow.rows[0].version).toBe("1");
      if (actions.rows[0].decision === "ALIVE") {
        expect(workflow.rows[0]).toMatchObject({ state: "CANCELLED", approved_count: 0 });
      } else {
        expect(workflow.rows[0]).toMatchObject({
          state: "AWAITING_CONFIRMATIONS",
          approved_count: 1,
        });
      }
    } finally {
      await cleanupWorkflow(concurrencyPool, workflowId, vaultId, contacts);
    }
  });
});
