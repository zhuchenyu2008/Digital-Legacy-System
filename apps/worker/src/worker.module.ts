import { createPgPool } from "@dls/persistence";
import { Module } from "@nestjs/common";
import { loadWorkerConfig } from "./config/load-config.js";
import {
  PostgresWorkerHeartbeatPort,
  WORKER_HEARTBEAT_PORT,
  WorkerHeartbeat,
} from "./health/worker-heartbeat.js";
import {
  CheckinEvaluateHandler,
  createCheckinEvaluateHandler,
} from "./jobs/checkin-evaluate.handler.js";
import {
  createNotificationDeliverHandler,
  NotificationDeliverHandler,
} from "./jobs/notification-deliver.handler.js";
import {
  createNotificationMaterializeHandler,
  NotificationMaterializeHandler,
} from "./jobs/notification-materialize.handler.js";
import { OutboxDispatchHandler } from "./jobs/outbox-dispatch.handler.js";
import {
  createPackageObjectDeleteHandler,
  PackageObjectDeleteHandler,
} from "./jobs/package-object-delete.handler.js";
import {
  createProcessReleaseFragmentHandler,
  ProcessReleaseFragmentHandler,
} from "./jobs/process-release-fragment.handler.js";
import {
  createPublicationFinalizeHandler,
  PublicationFinalizeHandler,
} from "./jobs/publication-finalize.handler.js";
import {
  createRecoveryExpireHandler,
  RecoveryExpireHandler,
} from "./jobs/recovery-expire.handler.js";
import {
  createWorkflowAdvanceHandler,
  WorkflowAdvanceHandler,
} from "./jobs/workflow-advance.handler.js";

@Module({
  providers: [
    {
      provide: WORKER_HEARTBEAT_PORT,
      useFactory: () =>
        new PostgresWorkerHeartbeatPort(
          createPgPool({ connectionString: loadWorkerConfig().databaseUrl }),
        ),
    },
    {
      provide: WorkerHeartbeat,
      inject: [WORKER_HEARTBEAT_PORT],
      useFactory: (port: PostgresWorkerHeartbeatPort) => new WorkerHeartbeat(port),
    },
    { provide: CheckinEvaluateHandler, useFactory: createCheckinEvaluateHandler },
    { provide: NotificationDeliverHandler, useFactory: createNotificationDeliverHandler },
    { provide: NotificationMaterializeHandler, useFactory: createNotificationMaterializeHandler },
    OutboxDispatchHandler,
    { provide: PackageObjectDeleteHandler, useFactory: createPackageObjectDeleteHandler },
    { provide: ProcessReleaseFragmentHandler, useFactory: createProcessReleaseFragmentHandler },
    { provide: PublicationFinalizeHandler, useFactory: createPublicationFinalizeHandler },
    { provide: RecoveryExpireHandler, useFactory: createRecoveryExpireHandler },
    { provide: WorkflowAdvanceHandler, useFactory: createWorkflowAdvanceHandler },
  ],
  exports: [
    WorkerHeartbeat,
    CheckinEvaluateHandler,
    NotificationDeliverHandler,
    NotificationMaterializeHandler,
    OutboxDispatchHandler,
    PackageObjectDeleteHandler,
    ProcessReleaseFragmentHandler,
    PublicationFinalizeHandler,
    RecoveryExpireHandler,
    WorkflowAdvanceHandler,
  ],
})
export class WorkerModule {}
