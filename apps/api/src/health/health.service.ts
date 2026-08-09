import { Injectable, ServiceUnavailableException } from "@nestjs/common";

export interface HealthProbe {
  check(): Promise<void>;
}

export const DATABASE_HEALTH_PROBE = Symbol("DATABASE_HEALTH_PROBE");
export const STORAGE_HEALTH_PROBE = Symbol("STORAGE_HEALTH_PROBE");
export const WORKER_HEARTBEAT_HEALTH_PROBE = Symbol("WORKER_HEARTBEAT_HEALTH_PROBE");

const liveStatus = Object.freeze({
  status: "ok" as const,
  service: "api" as const,
});

@Injectable()
export class HealthService {
  public constructor(
    private readonly database: HealthProbe,
    private readonly storage: HealthProbe,
    private readonly workerHeartbeat: HealthProbe,
  ) {}

  public live() {
    return liveStatus;
  }

  public async ready() {
    try {
      await this.database.check();
      await this.storage.check();
      await this.workerHeartbeat.check();
    } catch {
      throw new ServiceUnavailableException("dependency unavailable");
    }

    return {
      ...liveStatus,
      checks: { database: "ok" as const, storage: "ok" as const, workerHeartbeat: "ok" as const },
    };
  }
}
