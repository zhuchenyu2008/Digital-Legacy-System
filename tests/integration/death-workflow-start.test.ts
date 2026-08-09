import { evaluateCheckin } from "@dls/application";
import { createPgPool, PgTransactionManager } from "@dls/persistence";
import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { WorkflowsController } from "../../apps/api/src/workflows/workflows.controller.js";
import type { WorkflowRuntime } from "../../apps/api/src/workflows/workflows.runtime.js";

const ids = {
  schedule: "00000000-0000-4000-8000-000000000101",
  checkIn: "00000000-0000-4000-8000-000000000102",
  vault: "00000000-0000-4000-8000-000000000103",
  generation: "00000000-0000-4000-8000-000000000104",
  package: "00000000-0000-4000-8000-000000000105",
  contacts: [
    "00000000-0000-4000-8000-000000000111",
    "00000000-0000-4000-8000-000000000112",
    "00000000-0000-4000-8000-000000000113",
  ],
} as const;

async function seed(pool: Pool): Promise<void> {
  await pool.query(
    `INSERT INTO app.owner_profile (
       singleton_id, display_name_ciphertext, display_name_nonce, display_name_key_version,
       primary_email_ciphertext, primary_email_nonce, primary_email_key_version,
       primary_email_lookup_hmac, setup_state, irreversibility_accepted_at
     ) VALUES (true, decode('01', 'hex'), decode('02', 'hex'), 1,
       decode('03', 'hex'), decode('04', 'hex'), 1, digest('owner@example.test', 'sha256'),
       'ARMED', clock_timestamp())
     ON CONFLICT (singleton_id) DO UPDATE SET
       display_name_ciphertext = EXCLUDED.display_name_ciphertext,
       display_name_nonce = EXCLUDED.display_name_nonce,
       display_name_key_version = EXCLUDED.display_name_key_version,
       setup_state = 'ARMED',
       irreversibility_accepted_at = EXCLUDED.irreversibility_accepted_at`,
  );
  await pool.query(
    `INSERT INTO app.system_settings (
       singleton_id, timezone, missed_days_threshold, contact_consent_version,
       contact_consent_sha256, public_base_url, contact_set_version
     ) VALUES (true, 'Asia/Shanghai', 3, 'test-v1', digest('consent', 'sha256'),
       'http://localhost:3000', 91)
     ON CONFLICT (singleton_id) DO UPDATE SET contact_set_version = 91`,
  );
  await pool.query(
    `INSERT INTO app.vaults (
       id, owner_vault_envelope, owner_envelope_nonce, owner_envelope_algorithm,
       owner_envelope_protocol_version, owner_envelope_aad_hash, owner_kdf_salt,
       owner_kdf_params, vk_commitment, key_verifier_ciphertext, key_verifier_nonce
     ) VALUES ($1, decode('01', 'hex'), decode('02', 'hex'), 'test', 1,
       digest('aad', 'sha256'), decode('03', 'hex'), '{}'::jsonb, digest('vk', 'sha256'),
       decode('04', 'hex'), decode('05', 'hex'))`,
    [ids.vault],
  );
  await pool.query(
    `INSERT INTO app.share_generations (
       id, vault_id, generation_no, contact_count, death_threshold, recovery_threshold,
       contacts_snapshot_sha256, protocol_version, vss_scheme, generation_commitment,
       status, activated_at
     ) VALUES ($1, $2, 91, 3, 3, 2, digest('contacts', 'sha256'), 1,
       'AUDITED_PUBLICLY_VERIFIABLE_SHARING_V1', digest('generation', 'sha256'),
       'ACTIVE', clock_timestamp())`,
    [ids.generation, ids.vault],
  );
  await pool.query(`UPDATE app.vaults SET active_share_generation_id = $1 WHERE id = $2`, [
    ids.generation,
    ids.vault,
  ]);
  await pool.query(
    `INSERT INTO app.legacy_packages (
       id, version_no, status, object_key, cipher_algorithm, stream_header,
       ciphertext_size, ciphertext_sha256, dek_envelope, dek_envelope_nonce,
       dek_envelope_algorithm, dek_envelope_protocol_version, dek_envelope_aad_hash,
       manifest_ciphertext, manifest_nonce, manifest_algorithm, manifest_aad_hash,
       activated_at
     ) VALUES ($1, 91, 'ACTIVE', $2, 'test', decode('01', 'hex'), 1,
       digest('ciphertext', 'sha256'), decode('02', 'hex'), decode('03', 'hex'), 'test', 1,
       digest('dek', 'sha256'), decode('04', 'hex'), decode('05', 'hex'), 'test',
       digest('manifest', 'sha256'), clock_timestamp())`,
    [ids.package, `test/death-workflow/${ids.package}`],
  );
  for (const [offset, contactId] of ids.contacts.entries()) {
    await pool.query(
      `INSERT INTO app.emergency_contacts (
         id, status, display_name_ciphertext, display_name_nonce, display_name_key_version,
         display_name_lookup_hmac, email_ciphertext, email_nonce, email_key_version,
         email_lookup_hmac, password_phc, password_changed_at, password_pepper_version,
         password_kdf_version, password_normalization_version, x25519_public_key,
         registered_at, active_share_generation_id
       ) VALUES ($1, 'ACTIVE', $2, $3, 1, $4, $5, $6, 1, $7, 'test-hash',
         clock_timestamp(), 1, 1, 1, $8, clock_timestamp(), $9)`,
      [
        contactId,
        Buffer.from([10 + offset]),
        Buffer.alloc(12, 20 + offset),
        Buffer.alloc(32, 30 + offset),
        Buffer.from([40 + offset]),
        Buffer.alloc(12, 50 + offset),
        Buffer.alloc(32, 60 + offset),
        Buffer.alloc(32, 70 + offset),
        ids.generation,
      ],
    );
    await pool.query(
      `INSERT INTO app.contact_key_shares (
         id, generation_id, contact_id, share_index, death_share_ciphertext,
         recovery_share_ciphertext, share_protocol_version, death_share_commitment,
         recovery_share_commitment
       ) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 1, $6, $7)`,
      [
        ids.generation,
        contactId,
        offset + 1,
        Buffer.alloc(48, 80 + offset),
        Buffer.alloc(48, 90 + offset),
        Buffer.alloc(64, 100 + offset),
        Buffer.alloc(64, 110 + offset),
      ],
    );
  }
  await pool.query(
    `INSERT INTO app.check_ins (
       id, beijing_date, checked_in_at, source, actor_type, request_id
     ) VALUES ($1, DATE '2026-08-01', clock_timestamp() - interval '8 days',
       'TEST', 'OWNER', gen_random_uuid())`,
    [ids.checkIn],
  );
  await pool.query(
    `INSERT INTO app.checkin_schedules (
       id, schedule_version, last_check_in_id, threshold_days, deadline_at, status
     ) VALUES ($1, 91, $2, 3, clock_timestamp() - interval '1 second', 'ACTIVE')`,
    [ids.schedule, ids.checkIn],
  );
}

async function cleanup(pool: Pool): Promise<void> {
  await pool.query(`DELETE FROM app.domain_outbox WHERE aggregate_id IN ($1, $2)`, [
    ids.schedule,
    ids.package,
  ]);
  const workflows = await pool.query(
    `SELECT id FROM app.workflows WHERE schedule_version_snapshot = 91`,
  );
  for (const row of workflows.rows) {
    await pool.query(`DELETE FROM app.domain_outbox WHERE aggregate_id = $1`, [row.id]);
    await pool.query(`DELETE FROM app.workflow_key_fragments WHERE workflow_id = $1`, [row.id]);
    await pool.query(`DELETE FROM app.workflow_contact_actions WHERE workflow_id = $1`, [row.id]);
    await pool.query(`DELETE FROM app.workflow_contacts WHERE workflow_id = $1`, [row.id]);
    await pool.query(`DELETE FROM app.workflows WHERE id = $1`, [row.id]);
  }
  await pool.query(`DELETE FROM app.checkin_schedules WHERE id = $1`, [ids.schedule]);
  await pool.query(`DELETE FROM app.check_ins WHERE id = $1`, [ids.checkIn]);
  await pool.query(`DELETE FROM app.contact_key_shares WHERE generation_id = $1`, [ids.generation]);
  await pool.query(`DELETE FROM app.emergency_contacts WHERE id = ANY($1::uuid[])`, [
    [...ids.contacts],
  ]);
  await pool.query(`UPDATE app.vaults SET active_share_generation_id = NULL WHERE id = $1`, [
    ids.vault,
  ]);
  await pool.query(`DELETE FROM app.share_generations WHERE id = $1`, [ids.generation]);
  await pool.query(`DELETE FROM app.vaults WHERE id = $1`, [ids.vault]);
  await pool.query(`DELETE FROM app.legacy_packages WHERE id = $1`, [ids.package]);
}

describe("death workflow start concurrency", () => {
  it("creates exactly one formal death workflow under concurrent due evaluations", async () => {
    const pool = createPgPool({
      connectionString:
        process.env.DATABASE_URL ?? "postgresql://postgres:test@127.0.0.1:55432/dls",
    });
    try {
      await cleanup(pool);
      await seed(pool);
      const transaction = new PgTransactionManager(pool);
      const results = await Promise.all([
        evaluateCheckin({ scheduleId: ids.schedule, scheduleVersion: 91 }, { transaction }),
        evaluateCheckin({ scheduleId: ids.schedule, scheduleVersion: 91 }, { transaction }),
      ]);
      expect(results.map((result) => result.status).sort()).toEqual(["ALREADY_STARTED", "STARTED"]);
      const persisted = await pool.query(
        `SELECT id, contact_count_snapshot, required_count_snapshot,
                package_version_snapshot, schedule_version_snapshot
         FROM app.workflows WHERE schedule_version_snapshot = 91`,
      );
      expect(persisted.rows).toHaveLength(1);
      expect(persisted.rows[0]).toMatchObject({
        contact_count_snapshot: 3,
        required_count_snapshot: 3,
        package_version_snapshot: 91,
        schedule_version_snapshot: "91",
      });
      const snapshots = await pool.query(
        `SELECT share_index FROM app.workflow_contacts WHERE workflow_id = $1 ORDER BY share_index`,
        [persisted.rows[0]?.id],
      );
      expect(snapshots.rows.map((row) => row.share_index)).toEqual([1, 2, 3]);
    } finally {
      await cleanup(pool);
      await pool.end();
    }
  });

  it("routes owner and contact queries using only the authenticated principal", async () => {
    const runtime = {
      ownerCurrent: async () => ({ workflowId: "workflow-1" }),
      contactCurrent: async (contactId: string) => ({ workflowId: "workflow-1", contactId }),
    } as unknown as WorkflowRuntime;
    const controller = new WorkflowsController(runtime);
    await expect(
      controller.ownerCurrent({ user: { actorId: "owner-1" } } as never),
    ).resolves.toEqual({ workflowId: "workflow-1" });
    await expect(
      controller.contactCurrent({ user: { actorId: "contact-2" } } as never),
    ).resolves.toEqual({ workflowId: "workflow-1", contactId: "contact-2" });
  });
});
