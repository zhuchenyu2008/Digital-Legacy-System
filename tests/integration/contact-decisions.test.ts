import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { ContactActionsController } from "../../apps/api/src/workflows/contact-actions.controller.js";
import type { WorkflowRuntime } from "../../apps/api/src/workflows/workflows.runtime.js";
import {
  affirmDeath,
  deathConfirmationText,
  processReleaseFragment,
  type ReleaseFragmentCryptography,
} from "../../packages/application/src/index.js";
import { createPgPool, PgTransactionManager } from "../../packages/persistence/src/index.js";

const ids = {
  workflow: "00000000-0000-4000-8000-000000000201",
  schedule: "00000000-0000-4000-8000-000000000202",
  checkIn: "00000000-0000-4000-8000-000000000203",
  vault: "00000000-0000-4000-8000-000000000204",
  generation: "00000000-0000-4000-8000-000000000205",
  package: "00000000-0000-4000-8000-000000000206",
  contacts: [
    "00000000-0000-4000-8000-000000000211",
    "00000000-0000-4000-8000-000000000212",
    "00000000-0000-4000-8000-000000000213",
  ],
  fragments: ["00000000-0000-4000-8000-000000000221", "00000000-0000-4000-8000-000000000222"],
} as const;

async function cleanup(pool: Pool): Promise<void> {
  await pool.query("DELETE FROM app.domain_outbox WHERE aggregate_id = ANY($1::uuid[])", [
    [ids.workflow, ids.schedule, ...ids.fragments],
  ]);
  await pool.query("DELETE FROM app.release_secret_sessions WHERE workflow_id = $1", [
    ids.workflow,
  ]);
  await pool.query("DELETE FROM app.workflow_key_fragments WHERE workflow_id = $1", [ids.workflow]);
  await pool.query("DELETE FROM app.workflow_contact_actions WHERE workflow_id = $1", [
    ids.workflow,
  ]);
  await pool.query("DELETE FROM app.workflow_contacts WHERE workflow_id = $1", [ids.workflow]);
  await pool.query("DELETE FROM app.workflows WHERE id = $1", [ids.workflow]);
  await pool.query("DELETE FROM app.idempotency_records WHERE actor_scope = ANY($1::text[])", [
    ids.contacts.map((contact) => `CONTACT:${contact}`),
  ]);
  await pool.query("DELETE FROM app.checkin_schedules WHERE id = $1", [ids.schedule]);
  await pool.query("DELETE FROM app.check_ins WHERE id = $1", [ids.checkIn]);
  await pool.query("DELETE FROM app.contact_key_shares WHERE generation_id = $1", [ids.generation]);
  await pool.query("DELETE FROM app.emergency_contacts WHERE id = ANY($1::uuid[])", [
    [...ids.contacts],
  ]);
  await pool.query("DELETE FROM app.legacy_packages WHERE id = $1", [ids.package]);
  await pool.query("UPDATE app.vaults SET active_share_generation_id = NULL WHERE id = $1", [
    ids.vault,
  ]);
  await pool.query("DELETE FROM app.share_generations WHERE id = $1", [ids.generation]);
  await pool.query("DELETE FROM app.vaults WHERE id = $1", [ids.vault]);
}

async function seed(pool: Pool): Promise<void> {
  await pool.query(
    `INSERT INTO app.owner_profile (
       singleton_id, display_name_ciphertext, display_name_nonce, display_name_key_version,
       primary_email_ciphertext, primary_email_nonce, primary_email_key_version,
       primary_email_lookup_hmac, setup_state, irreversibility_accepted_at
     ) VALUES (true, decode('01', 'hex'), decode('02', 'hex'), 1,
       decode('03', 'hex'), decode('04', 'hex'), 1, digest('owner@decision.test', 'sha256'),
       'ARMED', clock_timestamp())
     ON CONFLICT (singleton_id) DO UPDATE SET setup_state = 'ARMED',
       irreversibility_accepted_at = EXCLUDED.irreversibility_accepted_at`,
  );
  await pool.query(
    `INSERT INTO app.system_settings (
       singleton_id, timezone, missed_days_threshold, contact_consent_version,
       contact_consent_sha256, public_base_url, contact_set_version
     ) VALUES (true, 'Asia/Shanghai', 3, 'decision-v1', digest('consent', 'sha256'),
       'http://localhost:3000', 92)
     ON CONFLICT (singleton_id) DO UPDATE SET contact_set_version = 92`,
  );
  await pool.query(
    `INSERT INTO app.vaults (
       id, owner_vault_envelope, owner_envelope_nonce, owner_envelope_algorithm,
       owner_envelope_protocol_version, owner_envelope_aad_hash, owner_kdf_salt,
       owner_kdf_params, vk_commitment, key_verifier_ciphertext, key_verifier_nonce
     ) VALUES ($1, decode('01', 'hex'), decode('02', 'hex'), 'test', 1,
       digest('aad', 'sha256'), decode('03', 'hex'), '{}'::jsonb, $2,
       decode('04', 'hex'), decode('05', 'hex'))`,
    [ids.vault, Buffer.alloc(32, 7)],
  );
  await pool.query(
    `INSERT INTO app.share_generations (
       id, vault_id, generation_no, contact_count, death_threshold, recovery_threshold,
       contacts_snapshot_sha256, protocol_version, vss_scheme, generation_commitment,
       status, activated_at
     ) VALUES ($1, $2, 92, 3, 2, 2, digest('contacts', 'sha256'), 1,
       'AUDITED_PUBLICLY_VERIFIABLE_SHARING_V1', $3, 'ACTIVE', clock_timestamp())`,
    [ids.generation, ids.vault, Buffer.alloc(64, 9)],
  );
  await pool.query("UPDATE app.vaults SET active_share_generation_id = $1 WHERE id = $2", [
    ids.generation,
    ids.vault,
  ]);
  await pool.query(
    `INSERT INTO app.legacy_packages (
       id, vault_id, share_generation_id, version_no, status, object_key,
       expires_at, client_crypto_version, cipher_algorithm, stream_header,
       ciphertext_size, ciphertext_sha256, dek_envelope, dek_envelope_nonce,
       dek_envelope_algorithm, dek_envelope_protocol_version, dek_envelope_aad_hash,
       manifest_ciphertext, manifest_nonce, manifest_algorithm, manifest_aad_hash,
       activated_at
     ) VALUES ($1, $2, $3, 92, 'ACTIVE', $4,
       clock_timestamp() + interval '15 minutes', 'test-runtime-v1',
       'test', decode('01', 'hex'), 1,
       digest('ciphertext', 'sha256'), decode('02', 'hex'), decode('03', 'hex'), 'test', 1,
       digest('dek', 'sha256'), decode('04', 'hex'), decode('05', 'hex'), 'test',
       digest('manifest', 'sha256'), clock_timestamp())`,
    [ids.package, ids.vault, ids.generation, `test/contact-decisions/${ids.package}`],
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
        Buffer.alloc(64, 9),
        Buffer.alloc(64, 8),
      ],
    );
  }
  await pool.query(
    `INSERT INTO app.check_ins (id, beijing_date, checked_in_at, source, actor_type, request_id)
     VALUES ($1, DATE '2026-08-01', clock_timestamp() - interval '8 days',
       'TEST', 'OWNER', gen_random_uuid())`,
    [ids.checkIn],
  );
  await pool.query(
    `INSERT INTO app.checkin_schedules (
       id, schedule_version, last_check_in_id, threshold_days, deadline_at, status
     ) VALUES ($1, 92, $2, 3, clock_timestamp() - interval '1 second', 'TRIGGERED')`,
    [ids.schedule, ids.checkIn],
  );
  await pool.query(
    `INSERT INTO app.workflows (
       id, kind, state, contact_count_snapshot, required_count_snapshot, approved_count,
       share_generation_id, package_id, package_version_snapshot, schedule_version_snapshot,
       deadline_snapshot_at, owner_display_name_snapshot_ciphertext,
       owner_display_name_snapshot_nonce, owner_display_name_snapshot_key_version, started_at
     ) VALUES ($1, 'DEATH_CONFIRMATION', 'AWAITING_CONFIRMATIONS', 3, 2, 0,
       $2, $3, 92, 92, clock_timestamp() - interval '1 second', decode('01', 'hex'),
       decode('02', 'hex'), 1, clock_timestamp())`,
    [ids.workflow, ids.generation, ids.package],
  );
  for (const [offset, contactId] of ids.contacts.entries()) {
    await pool.query(
      `INSERT INTO app.workflow_contacts (
         workflow_id, contact_id, snapshot_position, contact_public_key, contact_set_version,
         share_index, display_name_snapshot_ciphertext, display_name_snapshot_nonce,
         display_name_snapshot_key_version, email_snapshot_ciphertext, email_snapshot_nonce,
         email_snapshot_key_version, email_snapshot_lookup_hmac
       ) VALUES ($1, $2, $3, $4, 92, $3, $5, $6, 1, $7, $8, 1, $9)`,
      [
        ids.workflow,
        contactId,
        offset + 1,
        Buffer.alloc(32, 70 + offset),
        Buffer.from([10 + offset]),
        Buffer.alloc(12, 20 + offset),
        Buffer.from([40 + offset]),
        Buffer.alloc(12, 50 + offset),
        Buffer.alloc(32, 60 + offset),
      ],
    );
  }
}

function fragment(contact: number) {
  return {
    generationId: ids.generation,
    shareIndex: contact,
    commitmentDigest: new Uint8Array(createHash("sha256").update(Buffer.alloc(64, 9)).digest()),
    ingressKeyVersion: 4,
    protocolVersion: 1 as const,
    nonce: new Uint8Array(24).fill(contact),
    ciphertext: new Uint8Array(96).fill(contact + 10),
  };
}

function workerDependencies(transaction: PgTransactionManager) {
  const releaseCryptography: ReleaseFragmentCryptography = {
    openStage: async ({ fragment: row }) => new Uint8Array(34).fill(Number(row.share_index)),
    verifyShare: async () => true,
    reconstruct: async () => new Uint8Array(32).fill(5),
    commitVaultKey: async () => new Uint8Array(32).fill(7),
    wrapReleaseVaultKey: async () => ({
      protocolVersion: 1,
      nonce: new Uint8Array(24).fill(6),
      ciphertext: new Uint8Array(48).fill(8),
    }),
  };
  return {
    transaction,
    stageKeys: {
      ingressKeyPair: async () => ({
        version: 4,
        publicKey: new Uint8Array(32).fill(1),
        privateKey: new Uint8Array(32).fill(2),
      }),
      currentStageKey: async () => ({ version: 6, key: new Uint8Array(32).fill(3) }),
      stageKey: async () => ({ version: 6, key: new Uint8Array(32).fill(3) }),
    },
    fragmentCryptography: {
      openIngress: async ({ context }: { context: { shareIndex: number } }) =>
        new Uint8Array(34).fill(context.shareIndex),
      verifyShare: async () => true,
      wrapStage: async ({ plaintextShare }: { plaintextShare: Uint8Array }) => ({
        protocolVersion: 1 as const,
        nonce: new Uint8Array(24).fill(4),
        ciphertext: new Uint8Array(plaintextShare),
      }),
    },
    releaseCryptography,
  };
}

describe("contact decisions with PostgreSQL", () => {
  it("creates one release session at threshold and destroys all transient fragments", async () => {
    const pool = createPgPool({
      connectionString:
        process.env.DATABASE_URL ?? "postgresql://postgres:test@127.0.0.1:55432/dls",
    });
    try {
      await cleanup(pool);
      await seed(pool);
      const transaction = new PgTransactionManager(pool);
      for (const contact of [1, 2]) {
        await affirmDeath(
          {
            workflowId: ids.workflow,
            contactId: ids.contacts[contact - 1] as string,
            password: "correct",
            confirmationText: deathConfirmationText("张三"),
            fragment: fragment(contact),
            requestId: `00000000-0000-4000-8000-00000000025${contact}`,
          },
          {
            transaction,
            passwordVerifier: async () => true,
            ownerDisplayName: async () => "张三",
            idFactory: () => ids.fragments[contact - 1] as string,
          },
        );
      }
      const dependencies = workerDependencies(transaction);
      const first = await processReleaseFragment(
        { fragmentId: ids.fragments[0] },
        {
          ...dependencies,
          idFactory: () => "00000000-0000-4000-8000-000000000231",
        },
      );
      const sequence = [
        "00000000-0000-4000-8000-000000000232",
        "00000000-0000-4000-8000-000000000241",
        randomUUID(),
      ];
      const second = await processReleaseFragment(
        { fragmentId: ids.fragments[1] },
        { ...dependencies, idFactory: () => sequence.shift() as string },
      );

      expect(first).toMatchObject({ status: "RECORDED", approvedCount: 1 });
      expect(second).toMatchObject({ status: "RELEASE_PENDING", approvedCount: 2 });
      const workflow = await pool.query(
        "SELECT state, approved_count, release_at FROM app.workflows WHERE id = $1",
        [ids.workflow],
      );
      expect(workflow.rows[0]).toMatchObject({ state: "RELEASE_PENDING", approved_count: 2 });
      const sessions = await pool.query(
        "SELECT status, stage_key_version FROM app.release_secret_sessions WHERE workflow_id = $1",
        [ids.workflow],
      );
      expect(sessions.rows).toEqual([{ status: "ACTIVE", stage_key_version: 6 }]);
      const fragments = await pool.query(
        `SELECT status, fragment_ciphertext, fragment_nonce
         FROM app.workflow_key_fragments WHERE workflow_id = $1`,
        [ids.workflow],
      );
      expect(fragments.rows).toHaveLength(2);
      expect(
        fragments.rows.every(
          (row) =>
            row.status === "DESTROYED" &&
            row.fragment_ciphertext === null &&
            row.fragment_nonce === null,
        ),
      ).toBe(true);
    } finally {
      await cleanup(pool);
      await pool.end();
    }
  });

  it("derives the acting contact only from the authenticated request principal", async () => {
    const observed: Array<Record<string, unknown>> = [];
    const runtime = {
      affirmDeath: async (command: Record<string, unknown>) => {
        observed.push(command);
        return { accepted: true, processing: true, fragmentId: "fragment-1" };
      },
    } as unknown as WorkflowRuntime;
    const controller = new ContactActionsController(runtime);
    await controller.affirm(
      "workflow-1",
      {
        password: "correct",
        confirmationText: "exact",
        fragment: {
          generationId: "generation-1",
          shareIndex: 1,
          commitmentDigest: Buffer.alloc(32).toString("base64url"),
          ingressKeyVersion: 1,
          protocolVersion: 1,
          nonce: Buffer.alloc(24).toString("base64url"),
          ciphertext: Buffer.alloc(64).toString("base64url"),
        },
      },
      { id: "request-1", user: { actorId: "contact-from-session" } } as never,
    );
    expect(observed[0]).toMatchObject({
      workflowId: "workflow-1",
      contactId: "contact-from-session",
      requestId: "request-1",
    });
  });
});
