import { Injectable } from "@nestjs/common";

export type WorkerHeartbeatRecord = Readonly<{
  service: "worker";
  observedAt: Date;
  version: "0.1.0";
}>;

export interface WorkerHeartbeatPort {
  writeHeartbeat(record: WorkerHeartbeatRecord): Promise<void>;
}

export const WORKER_HEARTBEAT_PORT = Symbol("WORKER_HEARTBEAT_PORT");

@Injectable()
export class InMemoryWorkerHeartbeatPort implements WorkerHeartbeatPort {
  public latest: WorkerHeartbeatRecord | undefined;

  public async writeHeartbeat(record: WorkerHeartbeatRecord): Promise<void> {
    this.latest = record;
  }
}

@Injectable()
export class WorkerHeartbeat {
  public constructor(
    private readonly port: WorkerHeartbeatPort,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async beat(): Promise<void> {
    await this.port.writeHeartbeat({
      service: "worker",
      observedAt: this.now(),
      version: "0.1.0",
    });
  }
}
