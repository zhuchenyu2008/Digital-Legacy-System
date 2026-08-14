import { describe, expect, it, vi } from "vitest";
import { resolveMigratorDatabaseUrl } from "../../ops/scripts/migrator-database-url.mjs";

describe("migrator database URL resolution", () => {
  it("prefers an explicitly configured database URL", async () => {
    const readPassword = vi.fn();
    await expect(
      resolveMigratorDatabaseUrl({
        environment: { DATABASE_URL: "postgresql://configured/dls" },
        readPassword,
      }),
    ).resolves.toBe("postgresql://configured/dls");
    expect(readPassword).not.toHaveBeenCalled();
  });

  it("reads and URL-encodes the mounted migrator password", async () => {
    await expect(
      resolveMigratorDatabaseUrl({
        environment: {},
        readPassword: async () => "p@ss:/ word\n",
      }),
    ).resolves.toBe("postgresql://dls_migrator:p%40ss%3A%2F%20word@postgres:5432/dls");
  });

  it("rejects an empty mounted password", async () => {
    await expect(
      resolveMigratorDatabaseUrl({ environment: {}, readPassword: async () => " \r\n" }),
    ).rejects.toThrow(/password.*empty/iu);
  });
});
