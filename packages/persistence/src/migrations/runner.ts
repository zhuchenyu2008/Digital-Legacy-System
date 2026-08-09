import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const REQUIRED_TABLES = [
  "app.owner_profile",
  "app.owner_credentials",
  "app.system_settings",
  "app.emergency_contacts",
  "app.contact_invitations",
  "app.contact_consents",
  "app.vaults",
  "app.share_generations",
  "app.contact_key_shares",
  "app.legacy_packages",
  "app.check_ins",
  "app.checkin_schedules",
  "app.workflows",
  "app.workflow_contacts",
  "app.workflow_contact_actions",
  "app.workflow_key_fragments",
  "app.release_secret_sessions",
  "app.recovery_secret_sessions",
  "app.password_rewrap_sessions",
  "app.auth_sessions",
  "app.one_time_tokens",
  "app.email_verification_codes",
  "app.notifications",
  "app.notification_attempts",
  "app.domain_outbox",
  "app.publications",
  "app.email_template_overrides",
  "app.rate_limit_buckets",
  "audit.private_events",
  "audit.public_events",
] as const;

export type MigrationFile = Readonly<{
  version: number;
  name: string;
  upPath: string;
  downPath: string;
}>;

export type MigrationQueryResult = Readonly<{
  rows: readonly Record<string, unknown>[];
  rowCount: number | null;
}>;

export interface MigrationClient {
  query(sql: string, values?: readonly unknown[]): Promise<MigrationQueryResult>;
}

export type MigrationClientFactory = () => Promise<MigrationClient>;

const DEFAULT_MIGRATIONS_DIR = fileURLToPath(new URL("../../migrations/", import.meta.url));

function parseMigrationName(fileName: string): { version: number; name: string } | null {
  const match = /^(\d+)_([a-z0-9_]+)\.up\.sql$/i.exec(fileName);
  if (!match) return null;
  const versionText = match[1];
  const name = match[2];
  if (versionText === undefined || name === undefined) return null;
  return { version: Number(versionText), name };
}

export async function listMigrationFiles(
  migrationsDir = DEFAULT_MIGRATIONS_DIR,
): Promise<readonly MigrationFile[]> {
  const names = await readdir(migrationsDir);
  const files = names
    .map(parseMigrationName)
    .filter((value): value is { version: number; name: string } => value !== null)
    .sort((a, b) => a.version - b.version);

  const versions = new Set<number>();
  return Promise.all(
    files.map(async ({ version, name }) => {
      if (versions.has(version)) {
        throw new Error(`duplicate migration version ${version}`);
      }
      versions.add(version);
      const upPath = join(migrationsDir, `${String(version).padStart(3, "0")}_${name}.up.sql`);
      const downPath = join(migrationsDir, `${String(version).padStart(3, "0")}_${name}.down.sql`);
      await readFile(downPath, "utf8");
      return { version, name, upPath, downPath };
    }),
  );
}

export async function readMigrationSql(file: MigrationFile | string): Promise<string> {
  return normalizeMigrationSql(
    await readFile(typeof file === "string" ? file : file.upPath, "utf8"),
  );
}

async function readDownMigrationSql(file: MigrationFile): Promise<string> {
  return normalizeMigrationSql(await readFile(file.downPath, "utf8"));
}

function normalizeMigrationSql(sql: string): string {
  return sql.replace(/\r\n?/gu, "\n");
}

function checksum(sql: string): string {
  return createHash("sha256").update(sql, "utf8").digest("hex");
}

async function begin(client: MigrationClient): Promise<void> {
  await client.query("BEGIN");
}

async function rollback(client: MigrationClient): Promise<void> {
  await client.query("ROLLBACK");
}

async function commit(client: MigrationClient): Promise<void> {
  await client.query("COMMIT");
}

async function ensureMetadataTable(client: MigrationClient): Promise<void> {
  await client.query("CREATE SCHEMA IF NOT EXISTS infra");
  await client.query(`
    CREATE TABLE IF NOT EXISTS infra.schema_migrations (
      version integer PRIMARY KEY,
      name text NOT NULL,
      checksum_sha256 text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )
  `);
}

async function lockMigrations(client: MigrationClient): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtext('dls:migrations:v1'))");
}

export type AppliedMigration = Readonly<{
  version: number;
  name: string;
  checksumSha256: string;
  appliedAt: string;
}>;

export class MigrationRunner {
  readonly #client: MigrationClient;
  readonly #migrationsDir: string;

  constructor(client: MigrationClient, migrationsDir = DEFAULT_MIGRATIONS_DIR) {
    this.#client = client;
    this.#migrationsDir = migrationsDir;
  }

  async up(): Promise<readonly AppliedMigration[]> {
    const files = await listMigrationFiles(this.#migrationsDir);
    await begin(this.#client);
    try {
      await ensureMetadataTable(this.#client);
      await lockMigrations(this.#client);
      const result = await this.#client.query(
        "SELECT version, name, checksum_sha256 FROM infra.schema_migrations ORDER BY version",
      );
      const applied = new Map(result.rows.map((row) => [Number(row.version), row]));
      for (const file of files) {
        const sql = await readMigrationSql(file);
        const existing = applied.get(file.version);
        if (existing) {
          if (existing.name !== file.name || existing.checksum_sha256 !== checksum(sql)) {
            throw new Error(`migration ${file.version} checksum or name changed`);
          }
          continue;
        }
        await this.#client.query(sql);
        await this.#client.query(
          `INSERT INTO infra.schema_migrations (version, name, checksum_sha256)
           VALUES ($1, $2, $3)`,
          [file.version, file.name, checksum(sql)],
        );
      }
      await commit(this.#client);
    } catch (error) {
      await rollback(this.#client);
      throw error;
    }
    return this.status();
  }

  async down(steps = 1): Promise<readonly AppliedMigration[]> {
    if (!Number.isSafeInteger(steps) || steps < 1) {
      throw new Error("migration down steps must be a positive safe integer");
    }
    const files = await listMigrationFiles(this.#migrationsDir);
    const byVersion = new Map(files.map((file) => [file.version, file]));
    await begin(this.#client);
    try {
      await ensureMetadataTable(this.#client);
      await lockMigrations(this.#client);
      const result = await this.#client.query(
        "SELECT version, name, checksum_sha256 FROM infra.schema_migrations ORDER BY version DESC LIMIT $1",
        [steps],
      );
      for (const row of result.rows) {
        const file = byVersion.get(Number(row.version));
        if (!file) throw new Error(`applied migration ${row.version} is missing from disk`);
        const sql = await readMigrationSql(file);
        if (row.name !== file.name || row.checksum_sha256 !== checksum(sql)) {
          throw new Error(`migration ${row.version} checksum or name changed`);
        }
        await this.#client.query(await readDownMigrationSql(file));
        await this.#client.query("DELETE FROM infra.schema_migrations WHERE version = $1", [
          file.version,
        ]);
      }
      await commit(this.#client);
    } catch (error) {
      await rollback(this.#client);
      throw error;
    }
    return this.status();
  }

  async status(): Promise<readonly AppliedMigration[]> {
    await ensureMetadataTable(this.#client);
    const result = await this.#client.query(
      `SELECT version, name, checksum_sha256, applied_at
       FROM infra.schema_migrations ORDER BY version`,
    );
    return result.rows.map((row) => ({
      version: Number(row.version),
      name: String(row.name),
      checksumSha256: String(row.checksum_sha256),
      appliedAt: String(row.applied_at),
    }));
  }
}

export function migrationDirectoryFromModule(moduleUrl: string): string {
  return dirname(fileURLToPath(new URL("../../migrations/", moduleUrl)));
}

export function migrationFileName(file: MigrationFile): string {
  return basename(file.upPath);
}
