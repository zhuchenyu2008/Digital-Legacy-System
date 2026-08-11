import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const workspace = resolve(import.meta.dirname, "../..");

describe("post-bootstrap migration privileges", () => {
  test("repairs existing runtime tables and installs least-privilege defaults", () => {
    const migration = readFileSync(
      resolve(workspace, "packages/persistence/migrations/019_runtime_table_privileges.up.sql"),
      "utf8",
    );

    expect(migration).toContain("app.idempotency_records, app.recovery_secret_sessions");
    expect(migration).toContain("GRANT SELECT, INSERT, UPDATE");
    expect(migration).toContain("TO dls_api");
    expect(migration).toContain("TO dls_worker");
    expect(migration).toContain("GRANT SELECT");
    expect(migration).toContain("TO dls_backup");
    expect(migration).toContain("ALTER DEFAULT PRIVILEGES FOR ROLE dls_migrator IN SCHEMA app");
  });
});
