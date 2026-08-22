import { Pool, type PoolConfig } from "pg";

const DEFAULT_POOL_MAX = 8;
const MIN_POOL_MAX = 1;
const MAX_POOL_MAX = 100;
const pools = new Map<string, Pool>();
let processPoolMax = DEFAULT_POOL_MAX;

function positiveInteger(value: string | number | undefined, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value ?? fallback);
  return Number.isSafeInteger(parsed) && parsed >= MIN_POOL_MAX ? parsed : fallback;
}

export function resolvePgPoolMax(
  environment: Record<string, string | undefined> = {},
  fallback = DEFAULT_POOL_MAX,
): number {
  const configured = positiveInteger(environment.DATABASE_POOL_MAX, fallback);
  return Math.min(MAX_POOL_MAX, configured);
}

export function configurePgPoolMax(max: number): void {
  processPoolMax = Math.min(MAX_POOL_MAX, positiveInteger(max, DEFAULT_POOL_MAX));
}

function poolKey(config: PoolConfig): string {
  if (config.connectionString !== undefined) return config.connectionString;
  return JSON.stringify({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    ssl: config.ssl,
  });
}

export function createPgPool(config: PoolConfig): Pool {
  const key = poolKey(config);
  const existing = pools.get(key);
  if (existing !== undefined && !existing.ended && !existing.ending) return existing;

  const processMax = processPoolMax;
  const configuredMax =
    config.max === undefined ? processMax : positiveInteger(config.max, processMax);
  const pool = new Pool({
    ...config,
    max: configuredMax,
    idleTimeoutMillis: 30_000,
  });
  pools.set(key, pool);
  pool.once("end", () => {
    if (pools.get(key) === pool) pools.delete(key);
  });
  return pool;
}

export async function closePgPools(): Promise<void> {
  const activePools = [...pools.values()];
  pools.clear();
  await Promise.all(activePools.map((pool) => pool.end()));
}
