import { Client } from "pg";
import { describe, expect, it } from "vitest";

import {
  listMigrationFiles,
  MigrationRunner,
  REQUIRED_TABLES,
  readMigrationSql,
} from "../../packages/persistence/src/migrations/runner.js";

function asMigrationClient(client: Client) {
  return {
    query: async (sql: string, values?: readonly unknown[]) => {
      const result = await client.query(sql, values === undefined ? undefined : [...values]);
      return { rows: result.rows, rowCount: result.rowCount };
    },
  };
}

describe("production migration inventory", () => {
  it("covers every table required by the database design", async () => {
    const files = await listMigrationFiles();
    const sql = (await Promise.all(files.map(readMigrationSql))).join("\n");

    for (const table of REQUIRED_TABLES) {
      expect(sql, `missing migration table ${table}`).toMatch(
        new RegExp(
          `create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?${table.replace(".", "\\.")}`,
          "i",
        ),
      );
    }
  });

  it("applies the complete schema to a blank PostgreSQL database", async () => {
    const client = new Client({
      connectionString:
        process.env.DATABASE_URL ?? "postgresql://postgres:test@127.0.0.1:55432/dls",
    });
    await client.connect();
    try {
      const runner = new MigrationRunner(asMigrationClient(client));
      const applied = await runner.up();
      expect(applied.map((migration) => migration.version)).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
      ]);

      const result = await client.query(
        `SELECT table_schema || '.' || table_name AS qualified_name
         FROM information_schema.tables
         WHERE table_schema IN ('app', 'audit')
         ORDER BY qualified_name`,
      );
      const tableNames = new Set(result.rows.map((row) => row.qualified_name));
      for (const table of REQUIRED_TABLES) {
        expect(tableNames, `missing migrated table ${table}`).toContain(table);
      }

      const fragmentColumns = await client.query(
        `SELECT column_name, is_nullable
         FROM information_schema.columns
         WHERE table_schema = 'app' AND table_name = 'workflow_key_fragments'`,
      );
      expect(
        Object.fromEntries(fragmentColumns.rows.map((row) => [row.column_name, row.is_nullable])),
      ).toMatchObject({
        status: "NO",
        ingress_key_version: "NO",
        stage_key_version: "YES",
        protocol_version: "NO",
        share_index: "NO",
        fragment_commitment_digest: "NO",
        fragment_ciphertext: "YES",
        fragment_nonce: "YES",
        version: "NO",
      });

      await client.query(
        `CREATE TEMP TABLE fragment_representation_probe
         (LIKE app.workflow_key_fragments INCLUDING ALL)`,
      );
      const insertProbe = (
        status: string,
        ciphertext: Buffer | null,
        nonce: Buffer | null,
        stage: number | null,
      ) =>
        client.query(
          `INSERT INTO fragment_representation_probe (
             id, workflow_id, contact_id, purpose, generation_id, share_index,
             fragment_ciphertext, fragment_nonce, fragment_commitment,
             fragment_commitment_digest, decision_digest, status, ingress_key_version,
             stage_key_version, protocol_version
           ) VALUES (
             gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'DEATH', gen_random_uuid(), 1,
             $1, $2, decode('01', 'hex'), digest(decode('01', 'hex'), 'sha256'),
             digest('decision', 'sha256'), $3, 1, $4, 1
           )`,
          [ciphertext, nonce, status, stage],
        );
      await expect(
        insertProbe("PENDING", Buffer.alloc(49), Buffer.alloc(24), null),
      ).resolves.toBeDefined();
      await expect(
        insertProbe("VALIDATED", Buffer.alloc(17), Buffer.alloc(24), 1),
      ).resolves.toBeDefined();
      await expect(insertProbe("REJECTED", null, null, null)).resolves.toBeDefined();
      await expect(insertProbe("DESTROYED", null, null, null)).resolves.toBeDefined();
      await expect(
        insertProbe("REJECTED", Buffer.alloc(17), Buffer.alloc(24), null),
      ).rejects.toMatchObject({
        code: "23514",
      });
      await expect(
        insertProbe("VALIDATED", Buffer.alloc(17), Buffer.alloc(24), null),
      ).rejects.toMatchObject({
        code: "23514",
      });

      const workflowSnapshotColumns = await client.query(
        `SELECT table_name, column_name, is_nullable
         FROM information_schema.columns
         WHERE table_schema = 'app'
           AND (
             (table_name = 'workflows' AND column_name IN (
               'package_version_snapshot', 'schedule_version_snapshot', 'deadline_snapshot_at',
               'owner_display_name_snapshot_ciphertext', 'owner_display_name_snapshot_nonce',
               'owner_display_name_snapshot_key_version'
             ))
             OR
             (table_name = 'workflow_contacts' AND column_name IN (
               'share_index', 'display_name_snapshot_ciphertext', 'display_name_snapshot_nonce',
               'display_name_snapshot_key_version', 'email_snapshot_ciphertext',
               'email_snapshot_nonce', 'email_snapshot_key_version', 'email_snapshot_lookup_hmac'
             ))
             OR (table_name = 'checkin_schedules' AND column_name = 'version')
           )`,
      );
      expect(workflowSnapshotColumns.rows).toHaveLength(15);
      expect(workflowSnapshotColumns.rows.every((row) => row.is_nullable === "NO")).toBe(true);

      const decisionColumns = await client.query(
        `SELECT table_name, column_name, is_nullable
         FROM information_schema.columns
         WHERE table_schema = 'app'
           AND (
             (table_name = 'workflow_key_fragments' AND column_name = 'decision_digest')
             OR
             (table_name = 'release_secret_sessions' AND column_name IN (
               'stage_key_version', 'status', 'version'
             ))
           )
         ORDER BY table_name, column_name`,
      );
      expect(decisionColumns.rows).toHaveLength(4);
      expect(decisionColumns.rows.every((row) => row.is_nullable === "NO")).toBe(true);

      const recoveryColumns = await client.query(
        `SELECT table_name, column_name, is_nullable
         FROM information_schema.columns
         WHERE table_schema = 'app'
           AND (
             (table_name = 'recovery_secret_sessions' AND column_name IN (
               'stage_key_envelope', 'stage_key_nonce', 'stage_key_version',
               'vault_key_commitment', 'status', 'version'
             ))
             OR
             (table_name = 'password_rewrap_sessions' AND column_name IN (
               'reset_token_hash', 'client_ephemeral_public_key',
               'sealed_vault_key_digest', 'status', 'version'
             ))
           )`,
      );
      expect(recoveryColumns.rows).toHaveLength(11);
      expect(
        recoveryColumns.rows
          .filter((row) => !["stage_key_envelope", "stage_key_nonce"].includes(row.column_name))
          .every((row) => row.is_nullable === "NO"),
      ).toBe(true);

      const notificationColumns = await client.query(
        `SELECT table_name, column_name, is_nullable
         FROM information_schema.columns
         WHERE table_schema = 'app'
           AND (
             (table_name = 'notifications' AND column_name IN (
               'template_version', 'fallback_email_ciphertext', 'fallback_email_nonce'
             ))
             OR
             (table_name = 'notification_attempts' AND column_name = 'provider_message_id_nonce')
           )`,
      );
      expect(notificationColumns.rows).toHaveLength(4);
      expect(
        notificationColumns.rows.find((row) => row.column_name === "template_version")?.is_nullable,
      ).toBe("NO");

      const publicationColumns = await client.query(
        `SELECT column_name, is_nullable
         FROM information_schema.columns
         WHERE table_schema = 'app' AND table_name = 'publications'
           AND column_name = 'owner_display_name'`,
      );
      expect(publicationColumns.rows).toEqual([
        { column_name: "owner_display_name", is_nullable: "NO" },
      ]);

      const vaultRuntimeColumns = await client.query(
        `SELECT column_name, is_nullable
         FROM information_schema.columns
         WHERE table_schema = 'app' AND table_name = 'legacy_packages'
           AND column_name IN (
             'vault_id', 'share_generation_id', 'expires_at', 'client_crypto_version',
             'failure_reason', 'storage_metadata'
           )`,
      );
      expect(vaultRuntimeColumns.rows).toHaveLength(6);
      expect(
        vaultRuntimeColumns.rows
          .filter((row) => !["failure_reason", "storage_metadata"].includes(row.column_name))
          .every((row) => row.is_nullable === "NO"),
      ).toBe(true);

      const afterDown = await runner.down(1);
      expect(afterDown.map((migration) => migration.version)).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
      ]);
      const afterUp = await runner.up();
      expect(afterUp.map((migration) => migration.version)).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
      ]);
    } finally {
      await client.end();
    }
  });
});
