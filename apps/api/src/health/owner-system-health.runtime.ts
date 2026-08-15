import { access } from "node:fs/promises";
import { createPgPool } from "@dls/persistence";
import type { StorageFactoryConfig } from "@dls/storage";
import type { Pool } from "pg";
import { getApiRuntimeConfig } from "../config/api-runtime-config.js";
import { getPublicRuntimeConfig } from "../config/public-runtime-config.js";

export const OWNER_SYSTEM_HEALTH_RUNTIME = Symbol("DLS_OWNER_SYSTEM_HEALTH_RUNTIME");

export type HealthCategoryStatus = "ok" | "degraded" | "unknown";
export type OwnerHealthCategory = Readonly<{
  code: "database" | "storage" | "worker" | "deadlineScanner" | "smtp";
  status: HealthCategoryStatus;
  backend?: "local-volume" | "s3-compatible";
  lastSeenAt?: string | null;
}>;

export type OwnerSystemHealth = Readonly<{
  serverNow: string;
  categories: readonly OwnerHealthCategory[];
  pendingJobs: number;
}>;

export interface OwnerSystemHealthRuntime {
  read(): Promise<OwnerSystemHealth>;
}

type Queryable = Pick<Pool, "query">;
type StorageCheck = () => Promise<boolean>;

async function defaultStorageCheck(storage: StorageFactoryConfig): Promise<boolean> {
  if (storage.driver === "s3") return false;
  try {
    await Promise.all([
      access(storage.privateRoot),
      access(storage.stagingRoot),
      access(storage.publicRoot),
    ]);
    return true;
  } catch {
    return false;
  }
}

function timestamp(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
}

export class PostgresOwnerSystemHealthRuntime implements OwnerSystemHealthRuntime {
  readonly #pool: Queryable;
  readonly #storage: StorageFactoryConfig;
  readonly #storageCheck: StorageCheck;
  readonly #workerHeartbeatStaleMs: number;

  public constructor(
    pool: Queryable,
    storage: StorageFactoryConfig,
    storageCheck: StorageCheck = () => defaultStorageCheck(storage),
    workerHeartbeatStaleMs = getApiRuntimeConfig().workerHeartbeatStaleMs,
  ) {
    this.#pool = pool;
    this.#storage = storage;
    this.#storageCheck = storageCheck;
    this.#workerHeartbeatStaleMs = workerHeartbeatStaleMs;
  }

  public async read(): Promise<OwnerSystemHealth> {
    const backend = this.#storage.driver === "s3" ? "s3-compatible" : "local-volume";
    let serverNow = new Date().toISOString();
    try {
      const clock = await this.#pool.query("SELECT clock_timestamp()::text AS server_now");
      serverNow = timestamp(clock.rows[0]?.server_now) ?? serverNow;
    } catch {
      return {
        serverNow,
        categories: [
          { code: "database", status: "degraded" },
          { code: "storage", status: "unknown", backend },
          { code: "worker", status: "unknown", lastSeenAt: null },
          { code: "deadlineScanner", status: "unknown", lastSeenAt: null },
          { code: "smtp", status: "unknown", lastSeenAt: null },
        ],
        pendingJobs: 0,
      };
    }

    const [outbox, notification, audit, storageAvailable, workerHeartbeat] = await Promise.all([
      this.#pool
        .query(
          `SELECT count(*)::int AS count FROM app.domain_outbox
           WHERE published_at IS NULL AND available_at <= clock_timestamp()`,
        )
        .catch(() => ({ rows: [{ count: 0 }] })),
      this.#pool
        .query(
          `SELECT finished_at::text AS finished_at, result
           FROM app.notification_attempts ORDER BY finished_at DESC LIMIT 1`,
        )
        .catch(() => ({ rows: [] })),
      this.#pool
        .query(
          `SELECT occurred_at::text AS occurred_at FROM audit.private_events
           WHERE event_type IN ('CHECKIN_EVALUATED', 'DEATH_WORKFLOW_STARTED', 'WORKFLOW_ADVANCED')
           ORDER BY occurred_at DESC LIMIT 1`,
        )
        .catch(() => ({ rows: [] })),
      this.#storageCheck().catch(() => false),
      this.#pool
        .query(
          `SELECT last_seen_at::text AS last_seen_at,
                  EXTRACT(EPOCH FROM (clock_timestamp() - last_seen_at)) * 1000 AS age_ms
           FROM app.worker_heartbeats WHERE service = 'worker'`,
        )
        .catch(() => ({ rows: [] })),
    ]);

    const notificationRow = notification.rows[0];
    const auditRow = audit.rows[0];
    const heartbeatRow = workerHeartbeat.rows[0] as
      | { last_seen_at?: unknown; age_ms?: unknown }
      | undefined;
    const heartbeatAge = Number(heartbeatRow?.age_ms);
    const workerStatus: HealthCategoryStatus =
      heartbeatRow === undefined || !Number.isFinite(heartbeatAge)
        ? "unknown"
        : heartbeatAge <= this.#workerHeartbeatStaleMs
          ? "ok"
          : "degraded";
    const notificationResult = String(notificationRow?.result ?? "");
    return {
      serverNow,
      categories: [
        { code: "database", status: "ok" },
        { code: "storage", status: storageAvailable ? "ok" : "unknown", backend },
        {
          code: "worker",
          status: workerStatus,
          lastSeenAt: timestamp(heartbeatRow?.last_seen_at),
        },
        {
          code: "deadlineScanner",
          status: "unknown",
          lastSeenAt: timestamp(auditRow?.occurred_at),
        },
        {
          code: "smtp",
          status:
            notificationRow === undefined
              ? "unknown"
              : notificationResult === "ACCEPTED"
                ? "ok"
                : "degraded",
          lastSeenAt: timestamp(notificationRow?.finished_at),
        },
      ],
      pendingJobs: Number(outbox.rows[0]?.count ?? 0),
    };
  }
}

export function createOwnerSystemHealthRuntime(): OwnerSystemHealthRuntime {
  const config = getPublicRuntimeConfig();
  return new PostgresOwnerSystemHealthRuntime(
    createPgPool({ connectionString: getApiRuntimeConfig().databaseUrl }),
    config.storage,
  );
}
