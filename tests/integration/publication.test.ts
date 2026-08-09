import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AesFieldProtector } from "../../apps/api/src/setup/setup.runtime.js";
import { workerPublicationCryptography } from "../../apps/worker/src/jobs/publication-finalize.handler.js";
import {
  finalizePublication,
  getPublication,
  getPublicationAudit,
  openPublicDownload,
} from "../../packages/application/src/index.js";
import {
  canonicalizeAad,
  decodeBase64Url,
  encryptStream,
  WRAPPED_KEY_ALGORITHM,
  wrapKeyV1,
} from "../../packages/crypto/src/index.js";
import {
  createPgPool,
  MigrationRunner,
  PgTransactionManager,
} from "../../packages/persistence/src/index.js";
import { createZip, bytes as textBytes } from "../../packages/storage/src/archive/test-zip.js";
import { createStorage, renderWill, ZipInspector } from "../../packages/storage/src/index.js";

const databaseUrl = process.env.DATABASE_URL ?? "postgresql://postgres:test@127.0.0.1:55432/dls";
const ids = {
  vault: "00000000-0000-4000-8000-000000000711",
  generation: "00000000-0000-4000-8000-000000000712",
  package: "00000000-0000-4000-8000-000000000713",
  workflow: "00000000-0000-4000-8000-000000000714",
  session: "00000000-0000-4000-8000-000000000715",
  contacts: [
    "00000000-0000-4000-8000-000000000721",
    "00000000-0000-4000-8000-000000000722",
    "00000000-0000-4000-8000-000000000723",
  ],
} as const;
const versionNo = 713;
const fieldSecret = textBytes("publication-field-secret-32-bytes-minimum");
const stageKey = new Uint8Array(32).fill(17);
const vaultKey = new Uint8Array(32).fill(23);
const dek = new Uint8Array(32).fill(31);

let pool: Pool;
let root: string;

function sha256(value: Uint8Array): Uint8Array {
  return createHash("sha256").update(value).digest();
}

async function collect(body: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of body) chunks.push(new Uint8Array(chunk));
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}

async function migrate(): Promise<void> {
  const client = await pool.connect();
  try {
    await new MigrationRunner({
      query: async (sql, values) => {
        const result = await client.query(sql, values === undefined ? undefined : [...values]);
        return { rows: result.rows, rowCount: result.rowCount };
      },
    }).up();
  } finally {
    client.release();
  }
}

async function cleanup(): Promise<void> {
  await pool.query(
    `SET session_replication_role = replica;
     DELETE FROM audit.public_events WHERE publication_id IN (
       SELECT id FROM app.publications WHERE workflow_id = '${ids.workflow}'::uuid
     );
     DELETE FROM app.publications WHERE workflow_id = '${ids.workflow}'::uuid;
     DELETE FROM audit.private_events WHERE target_id = '${ids.workflow}'::uuid;
     SET session_replication_role = origin;`,
  );
  await pool.query("DELETE FROM app.domain_outbox WHERE aggregate_id = $1", [ids.workflow]);
  await pool.query("DELETE FROM app.release_secret_sessions WHERE workflow_id = $1", [
    ids.workflow,
  ]);
  await pool.query("DELETE FROM app.workflow_contacts WHERE workflow_id = $1", [ids.workflow]);
  await pool.query("DELETE FROM app.workflows WHERE id = $1", [ids.workflow]);
  await pool.query("DELETE FROM app.emergency_contacts WHERE id = ANY($1::uuid[])", [
    [...ids.contacts],
  ]);
  await pool.query("UPDATE app.vaults SET active_share_generation_id = NULL WHERE id = $1", [
    ids.vault,
  ]);
  await pool.query("DELETE FROM app.share_generations WHERE id = $1", [ids.generation]);
  await pool.query("DELETE FROM app.vaults WHERE id = $1", [ids.vault]);
  await pool.query("DELETE FROM app.legacy_packages WHERE id = $1", [ids.package]);
}

async function seed(storage: ReturnType<typeof createStorage>) {
  const plaintext = createZip([
    { name: "will.md", body: textBytes("# 最后的话\n\n请记住我们一起度过的好时光。") },
    { name: "photos/readme.txt", body: textBytes("immutable memory") },
  ]);
  const ciphertextChunks: Uint8Array[] = [];
  await encryptStream({
    key: new Uint8Array(dek),
    context: { vaultId: ids.vault, packageId: ids.package, packageVersion: versionNo },
    chunks: (async function* () {
      yield plaintext.subarray(0, 11);
      yield plaintext.subarray(11);
    })(),
    onChunk: async (chunk) => void ciphertextChunks.push(new Uint8Array(chunk)),
  });
  const ciphertext = Buffer.concat(ciphertextChunks.map((chunk) => Buffer.from(chunk)));
  const packageAad = {
    protocol: "dls-crypto-v1",
    version: 1,
    algorithm: WRAPPED_KEY_ALGORITHM,
    purpose: "package-dek" as const,
    keyId: `package-kek-${versionNo}`,
    vaultId: ids.vault,
    packageId: ids.package,
    packageVersion: versionNo,
  };
  const dekEnvelope = await wrapKeyV1({
    key: new Uint8Array(dek),
    wrappingKey: new Uint8Array(vaultKey),
    aad: packageAad,
  });
  const releaseEnvelope = await wrapKeyV1({
    key: new Uint8Array(vaultKey),
    wrappingKey: new Uint8Array(stageKey),
    aad: {
      protocol: "DLS/RELEASE-STAGE/V1",
      version: 1,
      algorithm: WRAPPED_KEY_ALGORITHM,
      purpose: "release-stage-vk",
      keyId: ids.workflow,
      vaultId: ids.vault,
    },
  });
  const protector = new AesFieldProtector(fieldSecret);
  const owner = await protector.protect("张三", "owner-display-name");

  await pool.query(
    `INSERT INTO app.vaults (
       id, owner_vault_envelope, owner_envelope_nonce, owner_envelope_algorithm,
       owner_envelope_protocol_version, owner_envelope_aad_hash, owner_kdf_salt,
       owner_kdf_params, vk_commitment, key_verifier_ciphertext, key_verifier_nonce
     ) VALUES ($1, decode('01', 'hex'), decode('02', 'hex'), 'test', 1,
       digest('aad', 'sha256'), decode('03', 'hex'), '{}'::jsonb, $2,
       decode('04', 'hex'), decode('05', 'hex'))`,
    [ids.vault, sha256(vaultKey)],
  );
  await pool.query(
    `INSERT INTO app.share_generations (
       id, vault_id, generation_no, contact_count, death_threshold, recovery_threshold,
       contacts_snapshot_sha256, protocol_version, vss_scheme, generation_commitment,
       status, activated_at
     ) VALUES ($1, $2, $3, 3, 3, 2, digest('publication-contacts', 'sha256'), 1,
       'AUDITED_PUBLICLY_VERIFIABLE_SHARING_V1', digest('publication-generation', 'sha256'),
       'ACTIVE', clock_timestamp())`,
    [ids.generation, ids.vault, versionNo],
  );
  await pool.query("UPDATE app.vaults SET active_share_generation_id = $1 WHERE id = $2", [
    ids.generation,
    ids.vault,
  ]);
  await pool.query(
    `INSERT INTO app.legacy_packages (
       id, version_no, status, object_key, cipher_algorithm, stream_header,
       ciphertext_size, ciphertext_sha256, dek_envelope, dek_envelope_nonce,
       dek_envelope_algorithm, dek_envelope_protocol_version, dek_envelope_aad_hash,
       manifest_ciphertext, manifest_nonce, manifest_algorithm, manifest_aad_hash, activated_at
     ) VALUES ($1, $2, 'ACTIVE', $3, 'XCHACHA20_POLY1305_SECRETSTREAM_V1', $4,
       $5, $6, $7, $8, $9, 1, $10, decode('01', 'hex'), decode('02', 'hex'),
       'test', digest('manifest', 'sha256'), clock_timestamp())`,
    [
      ids.package,
      versionNo,
      `${ids.package.slice(0, 2)}/${ids.package.slice(2, 4)}/${ids.package}`,
      ciphertext.subarray(8, 32),
      ciphertext.length,
      sha256(ciphertext),
      decodeBase64Url(dekEnvelope.ciphertext),
      decodeBase64Url(dekEnvelope.nonce),
      WRAPPED_KEY_ALGORITHM,
      sha256(canonicalizeAad(packageAad)),
    ],
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
  }
  await pool.query(
    `INSERT INTO app.workflows (
       id, kind, state, contact_count_snapshot, required_count_snapshot, approved_count,
       share_generation_id, package_id, package_version_snapshot, schedule_version_snapshot,
       deadline_snapshot_at, owner_display_name_snapshot_ciphertext,
       owner_display_name_snapshot_nonce, owner_display_name_snapshot_key_version,
       started_at, release_at, publish_locked_at
     ) VALUES ($1, 'DEATH_CONFIRMATION', 'RELEASE_PENDING', 3, 3, 3, $2, $3,
       $4::integer, $4::bigint,
       clock_timestamp() - interval '2 days', $5, $6, 1, clock_timestamp() - interval '2 days',
       clock_timestamp() - interval '1 day', clock_timestamp() - interval '1 minute')`,
    [ids.workflow, ids.generation, ids.package, versionNo, owner.ciphertext, owner.nonce],
  );
  for (const [offset, contactId] of ids.contacts.entries()) {
    await pool.query(
      `INSERT INTO app.workflow_contacts (
         workflow_id, contact_id, snapshot_position, contact_public_key, contact_set_version,
         share_index, display_name_snapshot_ciphertext, display_name_snapshot_nonce,
         display_name_snapshot_key_version, email_snapshot_ciphertext, email_snapshot_nonce,
         email_snapshot_key_version, email_snapshot_lookup_hmac
       ) VALUES ($1, $2, $3, $4, $5, $3, $6, $7, 1, $8, $9, 1, $10)`,
      [
        ids.workflow,
        contactId,
        offset + 1,
        Buffer.alloc(32, 70 + offset),
        versionNo,
        Buffer.from([10 + offset]),
        Buffer.alloc(12, 20 + offset),
        Buffer.from([40 + offset]),
        Buffer.alloc(12, 50 + offset),
        Buffer.alloc(32, 60 + offset),
      ],
    );
  }
  await pool.query(
    `INSERT INTO app.release_secret_sessions (
       id, workflow_id, stage_key_envelope, stage_key_nonce, stage_key_protocol_version,
       stage_key_version, status, expires_at
     ) VALUES ($1, $2, $3, $4, 1, 1, 'ACTIVE', clock_timestamp() + interval '1 day')`,
    [
      ids.session,
      ids.workflow,
      decodeBase64Url(releaseEnvelope.ciphertext),
      decodeBase64Url(releaseEnvelope.nonce),
    ],
  );
  await storage.put({
    namespace: "private",
    key: `${ids.package.slice(0, 2)}/${ids.package.slice(2, 4)}/${ids.package}`,
    body: (async function* () {
      yield ciphertext;
    })(),
    expectedBytes: ciphertext.length,
    expectedSha256: Buffer.from(sha256(ciphertext)).toString("hex"),
  });
  return { plaintext, protector };
}

beforeAll(async () => {
  pool = createPgPool({ connectionString: databaseUrl });
  root = await mkdtemp(join(tmpdir(), "dls-publication-"));
  await migrate();
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await pool.end();
  await rm(root, { recursive: true, force: true });
});

describe("immutable publication with PostgreSQL and filesystem storage", () => {
  it("decrypts, validates, commits once, serves ranges, and rejects mutation", async () => {
    const storage = createStorage({
      driver: "filesystem",
      privateRoot: join(root, "private"),
      stagingRoot: join(root, "staging"),
      publicRoot: join(root, "public"),
    });
    const { plaintext, protector } = await seed(storage);
    const transaction = new PgTransactionManager(pool);
    const idFactory = () => crypto.randomUUID();
    const dependencies = {
      transaction,
      storage,
      stageKeys: {
        currentStageKey: async () => ({ version: 1, key: new Uint8Array(stageKey) }),
        stageKey: async () => ({ version: 1, key: new Uint8Array(stageKey) }),
        ingressKeyPair: async () => ({
          version: 1,
          publicKey: new Uint8Array(32),
          privateKey: new Uint8Array(32),
        }),
      },
      cryptography: workerPublicationCryptography,
      archiveInspector: new ZipInspector(),
      willRenderer: renderWill,
      ownerDisplayName: (snapshot: {
        ciphertext: Uint8Array;
        nonce: Uint8Array;
        keyVersion: number;
      }) => protector.unprotect(snapshot, "owner-display-name"),
      idFactory,
    };

    const published = await finalizePublication(
      { workflowId: ids.workflow, aggregateVersion: 0 },
      dependencies,
    );
    expect(published.status).toBe("PUBLISHED");
    await expect(
      finalizePublication({ workflowId: ids.workflow, aggregateVersion: 0 }, dependencies),
    ).resolves.toMatchObject({
      status: "ALREADY_PUBLISHED",
      publicationId: published.publicationId,
    });
    await expect(getPublication(transaction)).resolves.toMatchObject({
      ownerDisplayName: "张三",
      package: { size: plaintext.length },
    });
    const audit = await getPublicationAudit(transaction);
    expect(audit).toHaveLength(5);
    expect(audit?.at(-1)?.eventHash).toBe((await getPublication(transaction))?.auditFinalHash);
    const range = await openPublicDownload(
      { range: { start: 4, endInclusive: 19 } },
      { transaction, storage },
    );
    expect(Buffer.from(await collect(range.body))).toEqual(Buffer.from(plaintext.slice(4, 20)));

    await expect(
      pool.query("UPDATE app.publications SET public_slug = 'withdrawn' WHERE workflow_id = $1", [
        ids.workflow,
      ]),
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      pool.query("DELETE FROM audit.public_events WHERE publication_id = $1", [
        published.publicationId,
      ]),
    ).rejects.toMatchObject({ code: "55000" });
    const roles = await pool.query(
      `SELECT rolname FROM pg_roles WHERE rolname IN ('dls_api', 'dls_worker') ORDER BY rolname`,
    );
    for (const role of roles.rows) {
      const privileges = await pool.query(
        `SELECT has_table_privilege($1, 'app.publications', 'UPDATE') AS can_update,
                has_table_privilege($1, 'app.publications', 'DELETE') AS can_delete`,
        [role.rolname],
      );
      expect(privileges.rows[0]).toEqual({ can_update: false, can_delete: false });
    }
  });
});
