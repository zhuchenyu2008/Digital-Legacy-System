import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";

import { createPgPool } from "../../packages/persistence/src/postgres/index.js";

export const concurrencyPool = createPgPool({
  connectionString: process.env.DATABASE_URL ?? "postgresql://postgres:test@127.0.0.1:55432/dls",
  max: 24,
});

export async function inTransaction<T>(client: PoolClient, work: () => Promise<T>): Promise<T> {
  await client.query("BEGIN");
  try {
    const result = await work();
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original transaction error.
    }
    throw error;
  }
}

export async function runSynchronized<T>(
  pool: Pick<Pool, "connect">,
  count: number,
  work: (client: PoolClient, index: number) => Promise<T>,
): Promise<T[]> {
  const clients = await Promise.all(Array.from({ length: count }, () => pool.connect()));
  let ready = 0;
  let start!: () => void;
  const allReady = new Promise<void>((resolve) => {
    start = resolve;
  });

  const tasks = clients.map(async (client, index) => {
    ready += 1;
    if (ready === count) start();
    await allReady;
    try {
      return await work(client, index);
    } finally {
      client.release();
    }
  });
  const settled = await Promise.allSettled(tasks);
  const failure = settled.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (failure) throw failure.reason;
  return settled.map((result) => (result as PromiseFulfilledResult<T>).value);
}

export async function insertVault(pool: Pick<Pool, "query">): Promise<string> {
  const result = await pool.query(
    `INSERT INTO app.vaults (
       owner_vault_envelope, owner_envelope_nonce, owner_envelope_algorithm,
       owner_envelope_protocol_version, owner_envelope_aad_hash, owner_kdf_salt,
       owner_kdf_params, vk_commitment, key_verifier_ciphertext, key_verifier_nonce,
       created_at, updated_at
     ) VALUES (
       decode('00', 'hex'), decode('00', 'hex'), 'test', 1, decode('00', 'hex'), decode('00', 'hex'),
       '{}'::jsonb, decode('00', 'hex'), decode('00', 'hex'), decode('00', 'hex'), clock_timestamp(), clock_timestamp()
     ) RETURNING id`,
  );
  return result.rows[0].id as string;
}

export async function insertContacts(
  pool: Pick<Pool, "query">,
  count: number,
  prefix = randomUUID(),
): Promise<string[]> {
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const result = await pool.query(
      `INSERT INTO app.emergency_contacts (
         status, display_name_ciphertext, display_name_nonce, display_name_key_version,
         display_name_lookup_hmac, email_ciphertext, email_nonce, email_key_version,
         email_lookup_hmac
       ) VALUES (
         'INVITED', decode('00', 'hex'), decode('00', 'hex'), 1, digest($1, 'sha256'),
         decode('00', 'hex'), decode('00', 'hex'), 1, digest($2, 'sha256')
       ) RETURNING id`,
      [
        `concurrency-contact-${prefix}-${index}`,
        `concurrency-contact-${prefix}-${index}@example.test`,
      ],
    );
    ids.push(result.rows[0].id as string);
  }
  return ids;
}

export async function insertActiveGeneration(
  pool: Pick<Pool, "query">,
  vaultId: string,
  contactCount: number,
): Promise<string> {
  const result = await pool.query(
    `INSERT INTO app.share_generations (
       vault_id, generation_no, contact_count, death_threshold, recovery_threshold,
       contacts_snapshot_sha256, protocol_version, vss_scheme, generation_commitment, status, activated_at
     ) VALUES ($1, 1, $2, 2, 2, decode('00', 'hex'), 1, 'test', decode('00', 'hex'), 'ACTIVE', clock_timestamp())
     RETURNING id`,
    [vaultId, contactCount],
  );
  const id = result.rows[0].id as string;
  await pool.query("UPDATE app.vaults SET active_share_generation_id = $1 WHERE id = $2", [
    id,
    vaultId,
  ]);
  return id;
}

export async function insertWorkflow(
  pool: Pick<Pool, "query">,
  vaultId: string,
  generationId: string,
  contactIds: readonly string[],
  state: string,
  requiredCount: number,
): Promise<string> {
  const packageRow = await pool.query(
    `INSERT INTO app.legacy_packages (
       version_no, status, object_key, cipher_algorithm, stream_header,
       ciphertext_size, ciphertext_sha256, dek_envelope, dek_envelope_nonce,
       dek_envelope_algorithm, dek_envelope_protocol_version, dek_envelope_aad_hash,
       manifest_ciphertext, manifest_nonce, manifest_algorithm, manifest_aad_hash,
       vault_id, share_generation_id, expires_at, client_crypto_version, activated_at
     ) VALUES (
       (SELECT COALESCE(MAX(version_no), 0) + 1 FROM app.legacy_packages),
       'ACTIVE', $1, 'test', decode('00', 'hex'), 0, digest('ciphertext', 'sha256'),
       decode('00', 'hex'), decode('00', 'hex'), 'test', 1, digest('dek', 'sha256'),
       decode('00', 'hex'), decode('00', 'hex'), 'test', digest('manifest', 'sha256'),
       $2, $3, clock_timestamp() + interval '15 minutes', 'concurrency-test-v1',
       clock_timestamp()
     ) RETURNING id, version_no`,
    [`concurrency/${randomUUID()}`, vaultId, generationId],
  );
  const workflow = await pool.query(
    `INSERT INTO app.workflows (
       kind, state, contact_count_snapshot, required_count_snapshot, approved_count,
       share_generation_id, package_id, package_version_snapshot, schedule_version_snapshot,
       deadline_snapshot_at, owner_display_name_snapshot_ciphertext,
       owner_display_name_snapshot_nonce, owner_display_name_snapshot_key_version,
       started_at, version
     ) VALUES ('DEATH_CONFIRMATION', $1::app.workflow_state, $2, $3, 0, $4, $5, $6, 1,
       clock_timestamp(), decode('00', 'hex'), decode('00', 'hex'), 1,
       clock_timestamp(), 0)
     RETURNING id`,
    [
      state,
      contactIds.length,
      requiredCount,
      generationId,
      packageRow.rows[0].id,
      packageRow.rows[0].version_no,
    ],
  );
  const workflowId = workflow.rows[0].id as string;
  for (const [index, contactId] of contactIds.entries()) {
    await pool.query(
      `INSERT INTO app.workflow_contacts (
         workflow_id, contact_id, snapshot_position, contact_public_key, contact_set_version,
         share_index, display_name_snapshot_ciphertext, display_name_snapshot_nonce,
         display_name_snapshot_key_version, email_snapshot_ciphertext, email_snapshot_nonce,
         email_snapshot_key_version, email_snapshot_lookup_hmac
       ) VALUES ($1::uuid, $2::uuid, $3, decode('00', 'hex'), 1, $3, decode('00', 'hex'),
         decode('00', 'hex'), 1, decode('00', 'hex'), decode('00', 'hex'), 1,
         digest($2::text, 'sha256'))`,
      [workflowId, contactId, index + 1],
    );
  }
  return workflowId;
}

export async function cleanupWorkflow(
  pool: Pick<Pool, "query">,
  workflowId: string,
  vaultId: string,
  contactIds: readonly string[],
) {
  const workflow = await pool.query("SELECT package_id FROM app.workflows WHERE id = $1", [
    workflowId,
  ]);
  await pool.query("DELETE FROM app.domain_outbox WHERE aggregate_id = $1", [workflowId]);
  await pool.query("DELETE FROM app.release_secret_sessions WHERE workflow_id = $1", [workflowId]);
  await pool.query("DELETE FROM app.workflow_key_fragments WHERE workflow_id = $1", [workflowId]);
  await pool.query("DELETE FROM app.workflow_contact_actions WHERE workflow_id = $1", [workflowId]);
  await pool.query("DELETE FROM app.workflow_contacts WHERE workflow_id = $1", [workflowId]);
  await pool.query("DELETE FROM app.workflows WHERE id = $1", [workflowId]);
  if (workflow.rows[0]?.package_id !== undefined) {
    await pool.query("DELETE FROM app.legacy_packages WHERE id = $1", [
      workflow.rows[0].package_id,
    ]);
  }
  await pool.query("UPDATE app.vaults SET active_share_generation_id = NULL WHERE id = $1", [
    vaultId,
  ]);
  await pool.query("DELETE FROM app.share_generations WHERE vault_id = $1", [vaultId]);
  await pool.query("DELETE FROM app.vaults WHERE id = $1", [vaultId]);
  await pool.query("DELETE FROM app.emergency_contacts WHERE id = ANY($1::uuid[])", [contactIds]);
}

export async function cleanupVault(pool: Pick<Pool, "query">, vaultId: string) {
  await pool.query("DELETE FROM app.domain_outbox WHERE aggregate_id = $1", [vaultId]);
  await pool.query("UPDATE app.vaults SET active_share_generation_id = NULL WHERE id = $1", [
    vaultId,
  ]);
  await pool.query("DELETE FROM app.share_generations WHERE vault_id = $1", [vaultId]);
  await pool.query("DELETE FROM app.vaults WHERE id = $1", [vaultId]);
}
