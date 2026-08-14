import { runMigrationCli } from "../../packages/persistence/dist/migrations/cli.js";
import { resolveMigratorDatabaseUrl } from "./migrator-database-url.mjs";

const databaseUrl = await resolveMigratorDatabaseUrl();

await runMigrationCli({ argv: ["status"], databaseUrl });
