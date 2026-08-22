import { parseRuntimeConfig, type RuntimeConfig } from "@dls/contracts";
import { resolvePgPoolMax } from "@dls/persistence";

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export type WorkerProcessConfig = RuntimeConfig &
  Readonly<{
    databasePoolMax: number;
    bossPoolMax: number;
    shutdownTimeoutMs: number;
  }>;

export function loadWorkerConfig(
  environment: Record<string, string | undefined> = process.env,
): WorkerProcessConfig {
  return Object.freeze({
    ...parseRuntimeConfig(environment),
    databasePoolMax: resolvePgPoolMax(environment, 4),
    bossPoolMax: Math.min(
      resolvePgPoolMax(environment, 4),
      positiveInteger(environment.DATABASE_BOSS_POOL_MAX, 3),
    ),
    shutdownTimeoutMs: positiveInteger(environment.WORKER_SHUTDOWN_TIMEOUT_MS, 30_000),
  });
}
