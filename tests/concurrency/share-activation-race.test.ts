import { afterAll, describe, expect, it } from "vitest";

import {
  cleanupVault,
  concurrencyPool,
  insertVault,
  inTransaction,
  runSynchronized,
} from "./helpers.js";

describe("share activation race", () => {
  afterAll(async () => {
    await concurrencyPool.end();
  });

  it("creates one active generation and one activation event", async () => {
    const vaultId = await insertVault(concurrencyPool);
    const generations = await concurrencyPool.query(
      `INSERT INTO app.share_generations (
         vault_id, generation_no, contact_count, death_threshold, recovery_threshold,
         contacts_snapshot_sha256, protocol_version, vss_scheme, generation_commitment, status
       ) VALUES
         ($1, 1, 3, 2, 2, decode('00', 'hex'), 1, 'test', decode('00', 'hex'), 'PREPARING'),
         ($1, 2, 3, 2, 2, decode('00', 'hex'), 1, 'test', decode('00', 'hex'), 'PREPARING')
       RETURNING id
      `,
      [vaultId],
    );
    const generationIds = generations.rows.map((row) => row.id as string);

    try {
      await runSynchronized(concurrencyPool, 20, (client, index) =>
        inTransaction(client, async () => {
          const vault = await client.query(
            "SELECT active_share_generation_id FROM app.vaults WHERE id = $1 FOR UPDATE",
            [vaultId],
          );
          if (vault.rows[0].active_share_generation_id !== null) return;
          const generationId = generationIds[index % generationIds.length];
          const activated = await client.query(
            "UPDATE app.share_generations SET status = 'ACTIVE', activated_at = clock_timestamp() WHERE id = $1 AND status = 'PREPARING' RETURNING id",
            [generationId],
          );
          if (activated.rowCount !== 1) return;
          await client.query(
            "UPDATE app.vaults SET active_share_generation_id = $1, version = version + 1, updated_at = clock_timestamp() WHERE id = $2 AND active_share_generation_id IS NULL",
            [generationId, vaultId],
          );
          await client.query(
            `INSERT INTO app.domain_outbox (event_type, aggregate_type, aggregate_id, payload, idempotency_key)
             VALUES ('SHARE_GENERATION_ACTIVATED', 'vault', $1::uuid, jsonb_build_object('aggregateId', $1::text, 'aggregateVersion', 1), $2)`,
            [vaultId, `${vaultId}:share-generation-activated`],
          );
        }),
      );

      const active = await concurrencyPool.query(
        "SELECT id FROM app.share_generations WHERE vault_id = $1 AND status = 'ACTIVE'",
        [vaultId],
      );
      const vault = await concurrencyPool.query(
        "SELECT active_share_generation_id, version FROM app.vaults WHERE id = $1",
        [vaultId],
      );
      const outbox = await concurrencyPool.query(
        "SELECT count(*)::int AS count FROM app.domain_outbox WHERE aggregate_id = $1 AND event_type = 'SHARE_GENERATION_ACTIVATED'",
        [vaultId],
      );
      expect(active.rows).toHaveLength(1);
      expect(vault.rows[0].active_share_generation_id).toBe(active.rows[0].id);
      expect(vault.rows[0].version).toBe("1");
      expect(outbox.rows[0].count).toBe(1);
    } finally {
      await cleanupVault(concurrencyPool, vaultId);
    }
  });
});
