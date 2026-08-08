import { runMigrationCli } from "../../packages/persistence/src/migrations/cli.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

await runMigrationCli({ argv: process.argv.slice(2), databaseUrl });
