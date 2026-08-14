import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import {
  approveRecovery,
  completePasswordReset,
  createRewrapSession,
  InMemorySessionStore,
  type RecoveryCryptography,
  requestRecovery,
  SessionService,
  startRecovery,
} from "../../packages/application/src/index.js";
import { createPgPool, PgTransactionManager } from "../../packages/persistence/src/index.js";

const ids = {
  workflow: "00000000-0000-4000-8000-000000000501",
  schedule: "00000000-0000-4000-8000-000000000502",
  checkIn: "00000000-0000-4000-8000-000000000503",
  vault: "00000000-0000-4000-8000-000000000504",
  generation: "00000000-0000-4000-8000-000000000505",
  package: "00000000-0000-4000-8000-000000000506",
  session: "00000000-0000-4000-8000-000000000507",
  contacts: [
    "00000000-0000-4000-8000-000000000511",
    "00000000-0000-4000-8000-000000000512",
    "00000000-0000-4000-8000-000000000513",
  ],
  fragments: ["00000000-0000-4000-8000-000000000521", "00000000-0000-4000-8000-000000000522"],
} as const;

const tokenPepper = new Uint8Array(32).fill(4);

async function cleanup(pool: Pool): Promise<void> {
  await pool.query("DELETE FROM app.domain_outbox WHERE aggregate_id = ANY($1::uuid[])", [
    [ids.workflow, ids.schedule, ...ids.fragments],
  ]);
  await pool.query("DELETE FROM app.auth_sessions WHERE id = $1", [ids.session]);
  await pool.query("DELETE FROM app.checkin_schedules WHERE id = $1", [ids.schedule]);
  await pool.query("DELETE FROM app.check_ins WHERE workflow_id = $1", [ids.workflow]);
  await pool.query("DELETE FROM app.email_verification_codes WHERE workflow_id = $1", [
    ids.workflow,
  ]);
  await pool.query("DELETE FROM app.password_rewrap_sessions WHERE workflow_id = $1", [
    ids.workflow,
  ]);
  await pool.query("DELETE FROM app.recovery_secret_sessions WHERE workflow_id = $1", [
    ids.workflow,
  ]);
  await pool.query("DELETE FROM app.one_time_tokens WHERE subject_id = $1", [ids.workflow]);
  await pool.query("DELETE FROM app.workflow_key_fragments WHERE workflow_id = $1", [ids.workflow]);
  await pool.query("DELETE FROM app.workflow_contact_actions WHERE workflow_id = $1", [
    ids.workflow,
  ]);
  await pool.query("DELETE FROM app.workflow_contacts WHERE workflow_id = $1", [ids.workflow]);
  await pool.query("DELETE FROM app.workflows WHERE id = $1", [ids.workflow]);
  await pool.query("DELETE FROM app.one_time_tokens WHERE purpose = 'ADMIN_RECOVERY_START'");
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
       decode('03', 'hex'), decode('04', 'hex'), 1, digest('owner@recovery.test', 'sha256'),
       'ARMED', clock_timestamp())
     ON CONFLICT (singleton_id) DO UPDATE SET setup_state = 'ARMED',
       irreversibility_accepted_at = EXCLUDED.irreversibility_accepted_at`,
  );
  await pool.query(
    `INSERT INTO app.owner_credentials (
       singleton_id, password_phc, password_changed_at, password_pepper_version,
       password_kdf_version, password_normalization_version
     ) VALUES (true, 'old-owner-hash', clock_timestamp(), 1, 1, 1)
     ON CONFLICT (singleton_id) DO UPDATE SET password_phc = 'old-owner-hash',
       password_changed_at = clock_timestamp(), credential_version = 0`,
  );
  await pool.query(
    `INSERT INTO app.system_settings (
       singleton_id, timezone, missed_days_threshold, contact_consent_version,
       contact_consent_sha256, public_base_url, contact_set_version
     ) VALUES (true, 'Asia/Shanghai', 3, 'recovery-v1', digest('consent', 'sha256'),
       'http://localhost:3000', 105)
     ON CONFLICT (singleton_id) DO UPDATE SET contact_set_version = 105`,
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
     ) VALUES ($1, $2, 105, 3, 3, 2, digest('contacts', 'sha256'), 1,
       'AUDITED_PUBLICLY_VERIFIABLE_SHARING_V1', $3, 'ACTIVE', clock_timestamp())`,
    [ids.generation, ids.vault, Buffer.alloc(64, 8)],
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
       manifest_ciphertext, manifest_nonce, manifest_algorithm, manifest_aad_hash, activated_at
     ) VALUES ($1, $2, $3, 105, 'ACTIVE', $4,
       clock_timestamp() + interval '15 minutes', 'test-runtime-v1',
       'test', decode('01', 'hex'), 1,
       digest('ciphertext', 'sha256'), decode('02', 'hex'), decode('03', 'hex'), 'test', 1,
       digest('dek', 'sha256'), decode('04', 'hex'), decode('05', 'hex'), 'test',
       digest('manifest', 'sha256'), clock_timestamp())`,
    [ids.package, ids.vault, ids.generation, `test/password-recovery/${ids.package}`],
  );
  for (const [offset, contactId] of ids.contacts.entries()) {
    await pool.query(
      `INSERT INTO app.emergency_contacts (
         id, status, display_name_ciphertext, display_name_nonce, display_name_key_version,
         display_name_lookup_hmac, email_ciphertext, email_nonce, email_key_version,
         email_lookup_hmac, password_phc, password_changed_at, password_pepper_version,
         password_kdf_version, password_normalization_version, x25519_public_key,
         registered_at, active_share_generation_id
       ) VALUES ($1, 'ACTIVE', $2, $3, 1, $4, $5, $6, 1, $7, $8,
         clock_timestamp(), 1, 1, 1, $9, clock_timestamp(), $10)`,
      [
        contactId,
        Buffer.from([10 + offset]),
        Buffer.alloc(12, 20 + offset),
        Buffer.alloc(32, 30 + offset),
        Buffer.from([40 + offset]),
        Buffer.alloc(12, 50 + offset),
        Buffer.alloc(32, 60 + offset),
        `contact-hash-${offset + 1}`,
        Buffer.alloc(32, 70 + offset),
        ids.generation,
      ],
    );
    await pool.query(
      `INSERT INTO app.contact_key_shares (
         generation_id, contact_id, share_index, death_share_ciphertext,
         recovery_share_ciphertext, share_protocol_version, death_share_commitment,
         recovery_share_commitment
       ) VALUES ($1, $2, $3, $4, $5, 1, $6, $7)`,
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
     ) VALUES ($1, 105, $2, 3, clock_timestamp() + interval '3 days', 'ACTIVE')`,
    [ids.schedule, ids.checkIn],
  );
  await pool.query(
    `INSERT INTO app.auth_sessions (
       id, session_token_hash, csrf_token_hash, token_hmac_key_version, actor_type, actor_id,
       credential_version, created_at, last_seen_at, idle_expires_at, absolute_expires_at
     ) VALUES ($1, digest('old-owner-session', 'sha256'), digest('old-owner-csrf', 'sha256'),
       1, 'OWNER', NULL, 0,
       clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '1 hour',
       clock_timestamp() + interval '1 day')`,
    [ids.session],
  );
}

const stageKeys = {
  ingressKeyPair: async () => ({
    version: 2,
    publicKey: new Uint8Array(32).fill(1),
    privateKey: new Uint8Array(32).fill(2),
  }),
  currentStageKey: async () => ({ version: 3, key: new Uint8Array(32).fill(3) }),
  stageKey: async () => ({ version: 3, key: new Uint8Array(32).fill(3) }),
};

const recoveryCryptography: RecoveryCryptography = {
  openStageShare: async ({ fragment }) => new Uint8Array(34).fill(Number(fragment.share_index)),
  verifyShare: async () => true,
  reconstruct: async () => new Uint8Array(32).fill(5),
  commitVaultKey: async () => new Uint8Array(32).fill(7),
  wrapRecoveryVaultKey: async () => ({
    protocolVersion: 1,
    nonce: new Uint8Array(24).fill(4),
    ciphertext: new Uint8Array(48).fill(5),
  }),
  openRecoveryVaultKey: async () => new Uint8Array(32).fill(5),
  sealVaultKey: async () => new Uint8Array(80).fill(6),
};

function fragment(index: number) {
  const commitment = Buffer.alloc(64, 8);
  return {
    generationId: ids.generation,
    shareIndex: index,
    commitmentDigest: new Uint8Array(createHash("sha256").update(commitment).digest()),
    ingressKeyVersion: 2,
    protocolVersion: 1 as const,
    nonce: new Uint8Array(24).fill(index),
    ciphertext: new Uint8Array(96).fill(index + 8),
  };
}

const replacementEnvelope = {
  ciphertext: Buffer.alloc(48, 1).toString("base64url"),
  nonce: Buffer.alloc(24, 2).toString("base64url"),
  kdfSalt: Buffer.alloc(16, 3).toString("base64url"),
  kdfParams: {
    algorithm: "argon2id" as const,
    memoryKiB: 65_536,
    iterations: 3,
    parallelism: 1,
    version: 19,
    purpose: "owner-vault-kek-v1" as const,
  },
  keyVerifierCiphertext: Buffer.alloc(48, 4).toString("base64url"),
  keyVerifierNonce: Buffer.alloc(24, 5).toString("base64url"),
  vkCommitment: Buffer.alloc(32, 7).toString("hex"),
  ownerEnvelopeProof: Buffer.alloc(32, 6).toString("base64url"),
};

describe("threshold password recovery with PostgreSQL", () => {
  it("persists one threshold workflow and atomically replaces owner credentials", async () => {
    const pool = createPgPool({
      connectionString:
        process.env.DATABASE_URL ?? "postgresql://postgres:test@127.0.0.1:55432/dls",
    });
    try {
      await cleanup(pool);
      await seed(pool);
      const transaction = new PgTransactionManager(pool);
      const sessionService = new SessionService(new InMemorySessionStore(), {
        pepper: new Uint8Array(32).fill(11),
      });
      let startToken = "";
      await requestRecovery(
        { requestId: "00000000-0000-4000-8000-000000000531" },
        {
          transaction,
          tokenPepper,
          tokenFactory: () => new Uint8Array(32).fill(1),
          onPrimaryStartToken: async (challenge) => {
            startToken = challenge.token;
          },
        },
      );
      const started = await startRecovery(
        {
          token: startToken,
          requestId: "00000000-0000-4000-8000-000000000532",
        },
        { transaction, tokenPepper, idFactory: () => ids.workflow },
      );
      expect(started).toMatchObject({ workflowId: ids.workflow, requiredCount: 2 });

      let resetToken = "";
      let code = "";
      for (const index of [1, 2]) {
        await approveRecovery(
          {
            workflowId: ids.workflow,
            contactId: ids.contacts[index - 1] as string,
            password: `password-${index}`,
            requestId: `00000000-0000-4000-8000-00000000053${index + 2}`,
            fragment: fragment(index),
          },
          {
            transaction,
            passwordVerifier: async (password, hash) =>
              password === `password-${index}` && hash === `contact-hash-${index}`,
            stageKeys,
            fragmentCryptography: {
              openIngress: async () => new Uint8Array(34).fill(index),
              verifyShare: async () => true,
              wrapStage: async () => ({
                protocolVersion: 1,
                nonce: new Uint8Array(24).fill(4),
                ciphertext: new Uint8Array(50).fill(index),
              }),
            },
            recoveryCryptography,
            tokenPepper,
            idFactory: () => ids.fragments[index - 1] as string,
            tokenFactory: () => new Uint8Array(32).fill(2),
            codeFactory: () => "12345678",
            onPrimaryResetChallenge: async (challenge) => {
              resetToken = challenge.token;
              code = challenge.code;
            },
          },
        );
      }

      const material = await createRewrapSession(
        {
          token: resetToken,
          emailVerificationCode: code,
          clientEphemeralPublicKey: new Uint8Array(32).fill(9),
        },
        {
          transaction,
          tokenPepper,
          recoveryCryptography,
          resetSessionTokenFactory: () => new Uint8Array(32).fill(3),
        },
      );
      const completed = await completePasswordReset(
        {
          resetSessionToken: material.resetSessionToken,
          newPassword: "a-new-owner-password",
          newOwnerVaultEnvelope: replacementEnvelope,
          vaultKeyProof: Buffer.alloc(32, 8).toString("base64url"),
          requestId: "00000000-0000-4000-8000-000000000539",
        },
        {
          transaction,
          sessionService,
          tokenPepper,
          recoveryCryptography,
          passwordHasher: async () => "new-owner-auth-hash",
          replacementVerifier: async () => true,
        },
      );
      expect(completed).toMatchObject({ completed: true, workflowState: "COMPLETED" });

      const workflow = await pool.query(
        "SELECT state, approved_count, end_reason FROM app.workflows WHERE id = $1",
        [ids.workflow],
      );
      const recoverySession = await pool.query(
        `SELECT status, stage_key_envelope, stage_key_nonce
         FROM app.recovery_secret_sessions WHERE workflow_id = $1`,
        [ids.workflow],
      );
      const rewrap = await pool.query(
        "SELECT status, completed_at FROM app.password_rewrap_sessions WHERE workflow_id = $1",
        [ids.workflow],
      );
      const credentials = await pool.query(
        "SELECT password_phc, credential_version FROM app.owner_credentials WHERE singleton_id",
      );
      const oldSession = await pool.query(
        "SELECT revoked_at FROM app.auth_sessions WHERE id = $1",
        [ids.session],
      );
      const fragments = await pool.query(
        `SELECT status, fragment_ciphertext, fragment_nonce
         FROM app.workflow_key_fragments WHERE workflow_id = $1`,
        [ids.workflow],
      );
      expect(workflow.rows[0]).toMatchObject({
        state: "COMPLETED",
        approved_count: 2,
        end_reason: "PASSWORD_RESET_COMPLETED",
      });
      expect(recoverySession.rows[0]).toMatchObject({
        status: "DESTROYED",
        stage_key_envelope: null,
        stage_key_nonce: null,
      });
      expect(rewrap.rows[0]).toMatchObject({ status: "CONSUMED" });
      expect(rewrap.rows[0].completed_at).not.toBeNull();
      expect(credentials.rows[0]).toMatchObject({
        password_phc: "new-owner-auth-hash",
        credential_version: "1",
      });
      expect(oldSession.rows[0].revoked_at).not.toBeNull();
      expect(
        fragments.rows.every(
          (row) =>
            row.status === "DESTROYED" &&
            row.fragment_ciphertext === null &&
            row.fragment_nonce === null,
        ),
      ).toBe(true);
      await expect(
        createRewrapSession(
          {
            token: resetToken,
            emailVerificationCode: code,
            clientEphemeralPublicKey: new Uint8Array(32).fill(9),
          },
          { transaction, tokenPepper, recoveryCryptography },
        ),
      ).rejects.toMatchObject({ code: "DLS-RECOVERY-CHALLENGE-INVALID" });
    } finally {
      await cleanup(pool);
      await pool.end();
    }
  });
});
