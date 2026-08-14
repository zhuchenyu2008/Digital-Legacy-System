import { runAuditVerificationCli } from "../../packages/persistence/dist/cli/verify-audit.js";
import { resolveMigratorDatabaseUrl } from "./migrator-database-url.mjs";

const databaseUrl = await resolveMigratorDatabaseUrl();

await runAuditVerificationCli({ argv: process.argv.slice(2), databaseUrl });
