import { runAuditVerificationCli } from "../../packages/persistence/dist/cli/verify-audit.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

await runAuditVerificationCli({ argv: process.argv.slice(2), databaseUrl });
