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

describe("affirmation race", () => {
  afterAll(async () => {
    await concurrencyPool.end();
  });

  it("serializes threshold transition, counters, and versioned outbox events", async () => {
    const vaultId = await insertVault(concurrencyPool);
    const contacts = await insertContacts(concurrencyPool, 20);
    const generationId = await insertActiveGeneration(concurrencyPool, vaultId, contacts.length);
    const workflowId = await insertWorkflow(
      concurrencyPool,
      vaultId,
      generationId,
      contacts,
      "AWAITING_APPROVALS",
      3,
    );

    try {
      await runSynchronized(concurrencyPool, 20, (client, index) =>
        inTransaction(client, async () => {
          const locked = await client.query(
            "SELECT state, approved_count, required_count_snapshot, version FROM app.workflows WHERE id = $1 FOR UPDATE",
            [workflowId],
          );
          const workflow = locked.rows[0];
          const action = await client.query(
            `INSERT INTO app.workflow_contact_actions (workflow_id, contact_id, decision, decision_digest)
             VALUES ($1, $2, 'DEATH_LIKELY', decode('00', 'hex'))
             ON CONFLICT (workflow_id, contact_id) DO NOTHING
             RETURNING id`,
            [workflowId, contacts[index]],
          );
          if (action.rowCount !== 1 || workflow.state !== "AWAITING_APPROVALS") return;

          const nextCount = Number(workflow.approved_count) + 1;
          const nextState =
            nextCount >= Number(workflow.required_count_snapshot)
              ? "RELEASE_PENDING"
              : "AWAITING_APPROVALS";
          const nextVersion = Number(workflow.version) + 1;
          await client.query(
            "UPDATE app.workflows SET approved_count = $2, state = $3::app.workflow_state, version = $4, updated_at = clock_timestamp() WHERE id = $1",
            [workflowId, nextCount, nextState, nextVersion],
          );
          await client.query(
            `INSERT INTO app.domain_outbox (event_type, aggregate_type, aggregate_id, payload, idempotency_key)
             VALUES ('WORKFLOW_VERSION', 'workflow', $1, $2::jsonb, $3)`,
            [
              workflowId,
              JSON.stringify({ aggregateId: workflowId, aggregateVersion: nextVersion }),
              `${workflowId}:${nextVersion}`,
            ],
          );
        }),
      );

      const workflow = await concurrencyPool.query(
        "SELECT state, approved_count, version FROM app.workflows WHERE id = $1",
        [workflowId],
      );
      const events = await concurrencyPool.query(
        "SELECT payload->>'aggregateVersion' AS version FROM app.domain_outbox WHERE aggregate_id = $1 ORDER BY payload->>'aggregateVersion'",
        [workflowId],
      );
      const actions = await concurrencyPool.query(
        "SELECT count(*)::int AS count FROM app.workflow_contact_actions WHERE workflow_id = $1",
        [workflowId],
      );
      expect(workflow.rows[0]).toMatchObject({
        state: "RELEASE_PENDING",
        approved_count: 3,
        version: "3",
      });
      expect(actions.rows[0].count).toBe(20);
      expect(events.rows.map((row) => row.version)).toEqual(["1", "2", "3"]);
    } finally {
      await cleanupWorkflow(concurrencyPool, workflowId, vaultId, contacts);
    }
  });
});
