import { Module } from "@nestjs/common";
import {
  InMemoryWorkerHeartbeatPort,
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
    InMemoryWorkerHeartbeatPort,
    { provide: WORKER_HEARTBEAT_PORT, useExisting: InMemoryWorkerHeartbeatPort },
    {
      provide: WorkerHeartbeat,
      inject: [WORKER_HEARTBEAT_PORT],
      useFactory: (port: InMemoryWorkerHeartbeatPort) => new WorkerHeartbeat(port),
    },
    { provide: CheckinEvaluateHandler, useFactory: createCheckinEvaluateHandler },
    { provide: NotificationDeliverHandler, useFactory: createNotificationDeliverHandler },
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
    OutboxDispatchHandler,
    PackageObjectDeleteHandler,
    ProcessReleaseFragmentHandler,
    PublicationFinalizeHandler,
    RecoveryExpireHandler,
    WorkflowAdvanceHandler,
  ],
})
export class WorkerModule {}
