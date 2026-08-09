import "reflect-metadata";
import { redactLogValue } from "@dls/contracts";
import { createPgPool, JOB_NAMES, PgBossScheduler, PgOutboxDispatcher } from "@dls/persistence";
import { ConsoleLogger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { PgBoss } from "pg-boss";
import { loadWorkerKeyCapabilities } from "./config/key-capabilities.js";
import { loadWorkerConfig } from "./config/load-config.js";
import { WorkerHeartbeat } from "./health/worker-heartbeat.js";
import { CheckinEvaluateHandler } from "./jobs/checkin-evaluate.handler.js";
import { registerJobHandlers, type WorkerBoss } from "./jobs/register-handlers.js";
import { WorkerModule } from "./worker.module.js";

async function bootstrap(): Promise<void> {
  const config = loadWorkerConfig();
  await loadWorkerKeyCapabilities();
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: new ConsoleLogger({ json: true, prefix: "worker" }),
  });
  const pool = createPgPool({ connectionString: config.databaseUrl });
  const boss = await new PgBoss(config.databaseUrl).start();
  for (const jobName of Object.values(JOB_NAMES)) await boss.createQueue(jobName);
  const checkinEvaluate = app.get(CheckinEvaluateHandler);
  await registerJobHandlers(boss as unknown as WorkerBoss, {
    [JOB_NAMES.CHECKIN_EVALUATE]: (job) => checkinEvaluate.handle(job),
  });
  const scheduler = new PgBossScheduler(boss);
  const dispatcher = new PgOutboxDispatcher(pool, {
    async publish(name, payload) {
      await scheduler.schedule(name, payload);
    },
  });
  const dispatchOutbox = () =>
    void dispatcher.dispatchBatch().catch((error: unknown) => {
      process.stderr.write(
        `${JSON.stringify(redactLogValue({ level: "error", event: "outbox_dispatch_failed", error }))}\n`,
      );
    });
  dispatchOutbox();
  setInterval(dispatchOutbox, 1_000);
  const heartbeat = app.get(WorkerHeartbeat);
  await heartbeat.beat();
  setInterval(() => void heartbeat.beat(), 30_000);
}

void bootstrap().catch((error: unknown) => {
  process.stderr.write(`${JSON.stringify(redactLogValue({ level: "fatal", error }))}\n`);
  process.exitCode = 1;
});
