import { AsyncLocalStorage } from "node:async_hooks";
import type { TransactionContext, TransactionManager } from "@dls/application";
import type { Pool, PoolClient } from "pg";
import { PgAuditWriter } from "../audit/pg-audit-writer.js";
import { mapDatabaseError, PersistenceError } from "./errors.js";
import { PgDatabaseClock } from "./pg-database-clock.js";
import { PgOutboxWriter } from "./pg-outbox.js";
import { createRepositories } from "./pg-repositories.js";

export class PgTransactionManager implements TransactionManager {
  readonly #pool: Pick<Pool, "connect">;
  readonly #scope = new AsyncLocalStorage<PoolClient>();

  constructor(pool: Pick<Pool, "connect">) {
    this.#pool = pool;
  }

  async run<T>(
    work: (tx: TransactionContext) => Promise<T>,
    options?: { isolation?: "read committed" | "serializable" },
  ): Promise<T> {
    if (this.#scope.getStore() !== undefined) {
      throw new PersistenceError(
        "NESTED_TRANSACTION",
        "Nested transaction scopes are not supported",
      );
    }
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      if (options?.isolation === "serializable") {
        await client.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
      }
      const context: TransactionContext = {
        repositories: createRepositories(client),
        clock: new PgDatabaseClock(client),
        outbox: new PgOutboxWriter(client),
        audit: new PgAuditWriter(client),
      };
      const result = await this.#scope.run(client, () => work(context));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the original transaction error.
      }
      const databaseCode = (error as { code?: unknown } | null)?.code;
      const isSqlState = typeof databaseCode === "string" && /^[0-9A-Z]{5}$/u.test(databaseCode);
      throw error instanceof PersistenceError || !isSqlState ? error : mapDatabaseError(error);
    } finally {
      client.release();
    }
  }
}
