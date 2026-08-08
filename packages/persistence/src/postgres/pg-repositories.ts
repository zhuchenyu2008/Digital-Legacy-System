import type {
  Repositories,
  RepositoryInput,
  RepositoryRow,
  VersionedRepository,
} from "@dls/application";
import type { PoolClient } from "pg";

import { mapDatabaseError, PersistenceError } from "./errors.js";
import { PgIdempotencyRepository } from "./pg-idempotency.js";

type Queryable = Pick<PoolClient, "query">;

type TableDefinition = Readonly<{
  table: string;
  primaryKey: string;
  versionColumn?: string;
}>;

function assertIdentifier(value: string): void {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value)) {
    throw new Error(`Invalid SQL identifier: ${value}`);
  }
}

function quoteIdentifier(value: string): string {
  assertIdentifier(value);
  return `"${value}"`;
}

function normalizeRow(row: Record<string, unknown>, versionColumn = "version"): RepositoryRow {
  return {
    ...row,
    ...(row[versionColumn] === undefined ? {} : { version: Number(row[versionColumn]) }),
  } as RepositoryRow;
}

function buildColumns(input: RepositoryInput): readonly string[] {
  const columns = Object.keys(input).sort();
  if (columns.length === 0) throw new Error("Repository insert requires at least one column");
  columns.forEach(assertIdentifier);
  return columns;
}

function buildTableRepository(client: Queryable, definition: TableDefinition): VersionedRepository {
  const [schema, table] = definition.table.split(".");
  if (schema === undefined || table === undefined) throw new Error("Invalid table definition");
  assertIdentifier(schema);
  assertIdentifier(table);
  assertIdentifier(definition.primaryKey);
  const versionColumn = definition.versionColumn ?? "version";
  assertIdentifier(versionColumn);
  const qualifiedTable = `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
  const primaryKey = quoteIdentifier(definition.primaryKey);

  return {
    async findById(id, options) {
      const lock = options?.forUpdate ? " FOR UPDATE" : "";
      try {
        const result = await client.query(
          `SELECT * FROM ${qualifiedTable} WHERE ${primaryKey} = $1${lock}`,
          [id],
        );
        const row = result.rows[0] as Record<string, unknown> | undefined;
        return row === undefined ? null : normalizeRow(row, versionColumn);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async findOneBy(field, value, options) {
      assertIdentifier(field);
      const lock = options?.forUpdate ? " FOR UPDATE" : "";
      try {
        const result = await client.query(
          `SELECT * FROM ${qualifiedTable} WHERE ${quoteIdentifier(field)} = $1${lock}`,
          [value],
        );
        const row = result.rows[0] as Record<string, unknown> | undefined;
        return row === undefined ? null : normalizeRow(row, versionColumn);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async findFirst(options) {
      const lock = options?.forUpdate ? " FOR UPDATE" : "";
      try {
        const result = await client.query(`SELECT * FROM ${qualifiedTable} LIMIT 1${lock}`);
        const row = result.rows[0] as Record<string, unknown> | undefined;
        return row === undefined ? null : normalizeRow(row, versionColumn);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async findMany(field, value, options) {
      if (field !== undefined) assertIdentifier(field);
      const lock = options?.forUpdate ? " FOR UPDATE" : "";
      const where = field === undefined ? "" : ` WHERE ${quoteIdentifier(field)} = $1`;
      try {
        const result = await client.query(
          `SELECT * FROM ${qualifiedTable}${where}${lock}`,
          field === undefined ? [] : [value],
        );
        return result.rows.map((row) =>
          normalizeRow(row as Record<string, unknown>, versionColumn),
        );
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async updateById(id, patch) {
      const columns = buildColumns(patch).filter((column) => column !== definition.primaryKey);
      if (columns.length === 0) throw new Error("Repository update requires a mutable column");
      const values = columns.map((column) => patch[column]);
      const assignments = columns.map(
        (column, index) => `${quoteIdentifier(column)} = $${index + 1}`,
      );
      try {
        const result = await client.query(
          `UPDATE ${qualifiedTable}
           SET ${assignments.join(", ")}
           WHERE ${primaryKey} = $${values.length + 1}
           RETURNING *`,
          [...values, id],
        );
        const row = result.rows[0] as Record<string, unknown> | undefined;
        if (row === undefined)
          throw new PersistenceError("NOT_FOUND", "Repository row was not found");
        return normalizeRow(row, versionColumn);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async insert(input) {
      const columns = buildColumns(input);
      const values = columns.map((column) => input[column]);
      const placeholders = columns.map((_, index) => `$${index + 1}`);
      try {
        const result = await client.query(
          `INSERT INTO ${qualifiedTable} (${columns.map(quoteIdentifier).join(", ")})
           VALUES (${placeholders.join(", ")}) RETURNING *`,
          values,
        );
        const row = result.rows[0] as Record<string, unknown> | undefined;
        if (row === undefined)
          throw new PersistenceError("DATABASE_ERROR", "Insert returned no row");
        return normalizeRow(row);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async updateVersioned(id, expectedVersion, patch) {
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
        throw new RangeError("Expected version must be a nonnegative safe integer");
      }
      const columns = buildColumns(patch).filter(
        (column) =>
          column !== definition.primaryKey && column !== versionColumn && column !== "updated_at",
      );
      if (columns.length === 0) throw new Error("Versioned update requires a mutable column");
      const values = columns.map((column) => patch[column]);
      const assignments = columns.map(
        (column, index) => `${quoteIdentifier(column)} = $${index + 1}`,
      );
      const idPlaceholder = `$${values.length + 1}`;
      const versionPlaceholder = `$${values.length + 2}`;
      try {
        const result = await client.query(
          `UPDATE ${qualifiedTable}
           SET ${assignments.join(", ")}, ${quoteIdentifier(versionColumn)} = ${quoteIdentifier(versionColumn)} + 1, "updated_at" = clock_timestamp()
           WHERE ${primaryKey} = ${idPlaceholder} AND ${quoteIdentifier(versionColumn)} = ${versionPlaceholder}
           RETURNING *`,
          [...values, id, expectedVersion],
        );
        const row = result.rows[0] as Record<string, unknown> | undefined;
        if (row !== undefined) return normalizeRow(row, versionColumn);

        const current = await client.query(
          `SELECT ${quoteIdentifier(versionColumn)} FROM ${qualifiedTable} WHERE ${primaryKey} = $1`,
          [id],
        );
        if (current.rows[0] === undefined) {
          throw new PersistenceError("NOT_FOUND", "Repository row was not found");
        }
        throw new PersistenceError("VERSION_CONFLICT", "Repository row version is stale");
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },
  };
}

export function createRepositories(client: PoolClient): Repositories {
  return {
    ownerProfile: buildTableRepository(client, {
      table: "app.owner_profile",
      primaryKey: "singleton_id",
    }),
    ownerCredentials: buildTableRepository(client, {
      table: "app.owner_credentials",
      primaryKey: "singleton_id",
      versionColumn: "credential_version",
    }),
    systemSettings: buildTableRepository(client, {
      table: "app.system_settings",
      primaryKey: "singleton_id",
    }),
    checkIns: buildTableRepository(client, { table: "app.check_ins", primaryKey: "id" }),
    checkinSchedules: buildTableRepository(client, {
      table: "app.checkin_schedules",
      primaryKey: "id",
    }),
    contacts: buildTableRepository(client, { table: "app.emergency_contacts", primaryKey: "id" }),
    contactInvitations: buildTableRepository(client, {
      table: "app.contact_invitations",
      primaryKey: "id",
    }),
    contactConsents: buildTableRepository(client, {
      table: "app.contact_consents",
      primaryKey: "id",
    }),
    vaults: buildTableRepository(client, { table: "app.vaults", primaryKey: "id" }),
    workflows: buildTableRepository(client, { table: "app.workflows", primaryKey: "id" }),
    packages: buildTableRepository(client, { table: "app.legacy_packages", primaryKey: "id" }),
    idempotency: new PgIdempotencyRepository(client),
  };
}
