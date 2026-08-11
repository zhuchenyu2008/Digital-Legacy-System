import { runMigrationCli } from "../../packages/persistence/dist/migrations/cli.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

await runMigrationCli({ argv: ["status"], databaseUrl });
