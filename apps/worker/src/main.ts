import "reflect-metadata";
import { redactLogValue } from "@dls/contracts";
import { createPgPool, JOB_NAMES, PgBossScheduler, PgOutboxDispatcher } from "@dls/persistence";
import { ConsoleLogger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { PgBoss } from "pg-boss";
import { loadWorkerConfig } from "./config/load-config.js";
import { WorkerHeartbeat } from "./health/worker-heartbeat.js";
import { CheckinEvaluateHandler } from "./jobs/checkin-evaluate.handler.js";
import { NotificationDeliverHandler } from "./jobs/notification-deliver.handler.js";
import { OutboxDispatchHandler } from "./jobs/outbox-dispatch.handler.js";
import { PackageObjectDeleteHandler } from "./jobs/package-object-delete.handler.js";
import { ProcessReleaseFragmentHandler } from "./jobs/process-release-fragment.handler.js";
import { PublicationFinalizeHandler } from "./jobs/publication-finalize.handler.js";
import { RecoveryExpireHandler } from "./jobs/recovery-expire.handler.js";
import { registerJobHandlers, type WorkerBoss } from "./jobs/register-handlers.js";
import { WorkflowAdvanceHandler } from "./jobs/workflow-advance.handler.js";
import { WorkerModule } from "./worker.module.js";

async function bootstrap(): Promise<void> {
  const config = loadWorkerConfig();
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: new ConsoleLogger({ json: true, prefix: "worker" }),
  });
  const pool = createPgPool({ connectionString: config.databaseUrl });
  const boss = await new PgBoss({ connectionString: config.databaseUrl, migrate: false }).start();
  for (const jobName of Object.values(JOB_NAMES)) await boss.createQueue(jobName);
  const checkinEvaluate = app.get(CheckinEvaluateHandler);
  const processReleaseFragment = app.get(ProcessReleaseFragmentHandler);
  const publicationFinalize = app.get(PublicationFinalizeHandler);
  const recoveryExpire = app.get(RecoveryExpireHandler);
  const notificationDeliver = app.get(NotificationDeliverHandler);
  const outboxDispatch = app.get(OutboxDispatchHandler);
  const packageObjectDelete = app.get(PackageObjectDeleteHandler);
  const workflowAdvance = app.get(WorkflowAdvanceHandler);
  await registerJobHandlers(boss as unknown as WorkerBoss, {
    [JOB_NAMES.CHECKIN_EVALUATE]: (job) => checkinEvaluate.handle(job),
    [JOB_NAMES.NOTIFICATION_DELIVER]: (job) => notificationDeliver.handle(job),
    [JOB_NAMES.OUTBOX_DISPATCH]: (job) => outboxDispatch.handle(job),
    [JOB_NAMES.PACKAGE_OBJECT_DELETE]: (job) => packageObjectDelete.handle(job),
    [JOB_NAMES.PROCESS_RELEASE_FRAGMENT]: (job) => processReleaseFragment.handle(job),
    [JOB_NAMES.PUBLICATION_FINALIZE]: (job) => publicationFinalize.handle(job),
    [JOB_NAMES.RECOVERY_EXPIRE]: (job) => recoveryExpire.handle(job),
    [JOB_NAMES.WORKFLOW_ADVANCE]: (job) => workflowAdvance.handle(job),
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
