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

describe("release and cancellation race", () => {
  afterAll(async () => {
    await concurrencyPool.end();
  });

  it("lets the first row-lock winner decide the persisted terminal state", async () => {
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

    try {
      await runSynchronized(concurrencyPool, 20, (client, index) =>
        inTransaction(client, async () => {
          const current = await client.query(
            "SELECT state, version FROM app.workflows WHERE id = $1 FOR UPDATE",
            [workflowId],
          );
          if (current.rows[0].state !== "RELEASE_PENDING") return;
          const terminalState = index % 2 === 0 ? "RELEASED" : "CANCELLED";
          const nextVersion = Number(current.rows[0].version) + 1;
          await client.query(
            "UPDATE app.workflows SET state = $2::app.workflow_state, version = $3, ended_at = clock_timestamp(), end_reason = $2 WHERE id = $1",
            [workflowId, terminalState, nextVersion],
          );
          await client.query(
            `INSERT INTO app.domain_outbox (event_type, aggregate_type, aggregate_id, payload, idempotency_key)
             VALUES ($2, 'workflow', $1::uuid, jsonb_build_object('aggregateId', $1::text, 'aggregateVersion', $3::int), $4)`,
            [workflowId, `WORKFLOW_${terminalState}`, nextVersion, `${workflowId}:${nextVersion}`],
          );
        }),
      );

      const workflow = await concurrencyPool.query(
        "SELECT state, version FROM app.workflows WHERE id = $1",
        [workflowId],
      );
      const outbox = await concurrencyPool.query(
        "SELECT event_type, payload->>'aggregateVersion' AS version FROM app.domain_outbox WHERE aggregate_id = $1",
        [workflowId],
      );
      expect(["RELEASED", "CANCELLED"]).toContain(workflow.rows[0].state);
      expect(workflow.rows[0].version).toBe("1");
      expect(outbox.rows).toHaveLength(1);
      expect(outbox.rows[0].event_type).toBe(`WORKFLOW_${workflow.rows[0].state}`);
      expect(outbox.rows[0].version).toBe("1");
    } finally {
      await cleanupWorkflow(concurrencyPool, workflowId, vaultId, contacts);
    }
  });
});
