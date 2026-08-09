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
  ],
  exports: [WorkerHeartbeat, CheckinEvaluateHandler],
})
export class WorkerModule {}
