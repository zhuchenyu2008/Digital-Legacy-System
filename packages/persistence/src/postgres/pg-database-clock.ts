import type { DatabaseClock } from "@dls/application";

import { type Instant, parseInstant } from "@dls/domain";
import type { PoolClient } from "pg";

export class PgDatabaseClock implements DatabaseClock {
  readonly #client: Pick<PoolClient, "query">;

  constructor(client: Pick<PoolClient, "query">) {
    this.#client = client;
  }

  async now(): Promise<Instant> {
    const result = await this.#client.query("SELECT clock_timestamp()::text AS now");
    const value = result.rows[0]?.now;
    if (typeof value !== "string") throw new Error("Database clock returned an invalid instant");
    return parseInstant(value);
  }
}
