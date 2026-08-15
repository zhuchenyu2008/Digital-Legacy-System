import { Injectable } from "@nestjs/common";
import type { Pool } from "pg";

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

export class PostgresWorkerHeartbeatPort implements WorkerHeartbeatPort {
  public constructor(private readonly database: Pick<Pool, "query">) {}

  public async writeHeartbeat(record: WorkerHeartbeatRecord): Promise<void> {
    await this.database.query(
      `INSERT INTO app.worker_heartbeats (service, last_seen_at, version)
       VALUES ($1, $2, $3)
       ON CONFLICT (service) DO UPDATE
       SET last_seen_at = EXCLUDED.last_seen_at,
           version = EXCLUDED.version,
           updated_at = clock_timestamp()`,
      [record.service, record.observedAt, record.version],
    );
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
