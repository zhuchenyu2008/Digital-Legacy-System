import { PgBoss } from "../../apps/worker/node_modules/pg-boss/dist/index.js";
import { resolveMigratorDatabaseUrl } from "./migrator-database-url.mjs";

const queueName = "backup-restore-smoke";
const boss = new PgBoss({
  connectionString: await resolveMigratorDatabaseUrl(),
  migrate: false,
  schedule: false,
  supervise: false,
});

let started = false;
try {
  await boss.start();
  started = true;
  await boss.createQueue(queueName);
  const jobId = await boss.send(
    queueName,
    { marker: "backup-restore-smoke" },
    { startAfter: new Date(Date.now() + 24 * 60 * 60 * 1_000) },
  );
  if (!jobId) throw new Error("pg-boss did not create the backup restore smoke job");
  process.stdout.write(`${JSON.stringify({ jobId, queueName, state: "created" })}\n`);
} finally {
  if (started) await boss.stop({ close: true, graceful: false });
}
