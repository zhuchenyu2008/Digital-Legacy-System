import { Client } from "pg";

const databaseUrl = process.env.DATABASE_URL ?? "postgresql://postgres:test@127.0.0.1:55432/dls";

export default async function cleanupInterruptedConcurrencyFixtures(): Promise<void> {
  if (
    !process.argv.some((argument) => argument.replaceAll("\\", "/").includes("tests/concurrency"))
  ) {
    return;
  }
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(`
      CREATE TEMP TABLE dls_concurrency_packages ON COMMIT DROP AS
        SELECT id FROM app.legacy_packages WHERE object_key LIKE 'concurrency/%';
      CREATE TEMP TABLE dls_concurrency_workflows ON COMMIT DROP AS
        SELECT id, share_generation_id
        FROM app.workflows
        WHERE package_id IN (SELECT id FROM dls_concurrency_packages);
      CREATE TEMP TABLE dls_concurrency_generations ON COMMIT DROP AS
        SELECT DISTINCT generation.id, generation.vault_id
        FROM app.share_generations AS generation
        JOIN dls_concurrency_workflows AS workflow
          ON workflow.share_generation_id = generation.id;
      CREATE TEMP TABLE dls_concurrency_contacts ON COMMIT DROP AS
        SELECT DISTINCT contact_id
        FROM app.workflow_contacts
        WHERE workflow_id IN (SELECT id FROM dls_concurrency_workflows);
      CREATE TEMP TABLE dls_concurrency_checkins ON COMMIT DROP AS
        SELECT id FROM app.check_ins
        WHERE workflow_id IN (SELECT id FROM dls_concurrency_workflows);

      DELETE FROM app.checkin_schedules
      WHERE last_check_in_id IN (SELECT id FROM dls_concurrency_checkins);
      DELETE FROM app.domain_outbox
      WHERE aggregate_id IN (SELECT id FROM dls_concurrency_workflows);
      DELETE FROM app.email_verification_codes
      WHERE workflow_id IN (SELECT id FROM dls_concurrency_workflows);
      DELETE FROM app.password_rewrap_sessions
      WHERE workflow_id IN (SELECT id FROM dls_concurrency_workflows);
      DELETE FROM app.recovery_secret_sessions
      WHERE workflow_id IN (SELECT id FROM dls_concurrency_workflows);
      DELETE FROM app.release_secret_sessions
      WHERE workflow_id IN (SELECT id FROM dls_concurrency_workflows);
      DELETE FROM app.one_time_tokens
      WHERE subject_id IN (SELECT id FROM dls_concurrency_workflows);
      DELETE FROM app.check_ins
      WHERE id IN (SELECT id FROM dls_concurrency_checkins);
      DELETE FROM app.workflow_key_fragments
      WHERE workflow_id IN (SELECT id FROM dls_concurrency_workflows);
      DELETE FROM app.workflow_contact_actions
      WHERE workflow_id IN (SELECT id FROM dls_concurrency_workflows);
      DELETE FROM app.workflow_contacts
      WHERE workflow_id IN (SELECT id FROM dls_concurrency_workflows);
      DELETE FROM app.workflows
      WHERE id IN (SELECT id FROM dls_concurrency_workflows);
      DELETE FROM app.contact_key_shares
      WHERE generation_id IN (SELECT id FROM dls_concurrency_generations);
      DELETE FROM app.emergency_contacts
      WHERE id IN (SELECT contact_id FROM dls_concurrency_contacts);
      UPDATE app.vaults SET active_share_generation_id = NULL
      WHERE id IN (SELECT vault_id FROM dls_concurrency_generations);
      DELETE FROM app.share_generations
      WHERE id IN (SELECT id FROM dls_concurrency_generations);
      DELETE FROM app.vaults
      WHERE id IN (SELECT vault_id FROM dls_concurrency_generations);
      DELETE FROM app.legacy_packages
      WHERE id IN (SELECT id FROM dls_concurrency_packages);

      CREATE TEMP TABLE dls_orphan_concurrency_generations ON COMMIT DROP AS
        SELECT generation.id, generation.vault_id
        FROM app.share_generations AS generation
        WHERE generation.status = 'ACTIVE'
          AND generation.vss_scheme = 'test'
          AND NOT EXISTS (
            SELECT 1 FROM app.workflows WHERE share_generation_id = generation.id
          )
          AND NOT EXISTS (
            SELECT 1 FROM app.contact_key_shares WHERE generation_id = generation.id
          )
          AND NOT EXISTS (
            SELECT 1 FROM app.emergency_contacts
            WHERE active_share_generation_id = generation.id
          );
      UPDATE app.vaults SET active_share_generation_id = NULL
      WHERE id IN (SELECT vault_id FROM dls_orphan_concurrency_generations);
      DELETE FROM app.share_generations
      WHERE id IN (SELECT id FROM dls_orphan_concurrency_generations);
      DELETE FROM app.vaults AS vault
      WHERE vault.id IN (SELECT vault_id FROM dls_orphan_concurrency_generations)
        AND NOT EXISTS (
          SELECT 1 FROM app.share_generations WHERE vault_id = vault.id
        );
    `);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}
