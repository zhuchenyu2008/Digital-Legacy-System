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
      expect(applied.map((migration) => migration.version)).toEqual([1, 2, 3, 4, 5, 6, 7]);

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

      const afterDown = await runner.down(1);
      expect(afterDown.map((migration) => migration.version)).toEqual([1, 2, 3, 4, 5, 6]);
      const afterUp = await runner.up();
      expect(afterUp.map((migration) => migration.version)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    } finally {
      await client.end();
    }
  });
});
