import { Pool, type PoolConfig } from "pg";

export function createPgPool(config: PoolConfig): Pool {
  return new Pool({
    max: 10,
    idleTimeoutMillis: 30_000,
    ...config,
  });
}
