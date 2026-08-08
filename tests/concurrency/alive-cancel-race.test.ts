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

describe("alive cancellation race", () => {
  afterAll(async () => {
    await concurrencyPool.end();
  });

  it("accepts one ALIVE decision and never decrements the approved counter", async () => {
    const vaultId = await insertVault(concurrencyPool);
    const contacts = await insertContacts(concurrencyPool, 2);
    const generationId = await insertActiveGeneration(concurrencyPool, vaultId, 3);
    const workflowId = await insertWorkflow(
      concurrencyPool,
      vaultId,
      generationId,
      contacts,
      "RELEASE_PENDING",
      2,
    );
    await concurrencyPool.query("UPDATE app.workflows SET approved_count = 2 WHERE id = $1", [
      workflowId,
    ]);

    try {
      await runSynchronized(concurrencyPool, 20, (client) =>
        inTransaction(client, async () => {
          await client.query("SELECT id FROM app.workflows WHERE id = $1 FOR UPDATE", [workflowId]);
          const action = await client.query(
            `INSERT INTO app.workflow_contact_actions (workflow_id, contact_id, decision, decision_digest)
             VALUES ($1, $2, 'ALIVE', decode('01', 'hex'))
             ON CONFLICT (workflow_id, contact_id) DO NOTHING
             RETURNING id`,
            [workflowId, contacts[0]],
          );
          if (action.rowCount !== 1) return;
          await client.query(
            "UPDATE app.workflows SET state = 'CANCELLED', version = version + 1, ended_at = clock_timestamp(), end_reason = 'ALIVE' WHERE id = $1 AND state = 'RELEASE_PENDING'",
            [workflowId],
          );
          await client.query(
            `INSERT INTO app.domain_outbox (event_type, aggregate_type, aggregate_id, payload, idempotency_key)
             VALUES ('ALIVE_CANCELLED', 'workflow', $1::uuid, jsonb_build_object('aggregateId', $1::text, 'aggregateVersion', 3), $2)`,
            [workflowId, `${workflowId}:alive-cancelled`],
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
      const outbox = await concurrencyPool.query(
        "SELECT count(*)::int AS count FROM app.domain_outbox WHERE aggregate_id = $1 AND event_type = 'ALIVE_CANCELLED'",
        [workflowId],
      );
      expect(workflow.rows[0]).toMatchObject({
        state: "CANCELLED",
        approved_count: 2,
        version: "1",
      });
      expect(actions.rows[0].count).toBe(1);
      expect(outbox.rows[0].count).toBe(1);
    } finally {
      await cleanupWorkflow(concurrencyPool, workflowId, vaultId, contacts);
    }
  });
});
