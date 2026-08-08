import type { AuditWriter } from "./audit.js";
import type { DatabaseClock } from "./database-clock.js";
import type { OutboxWriter } from "./outbox.js";
import type { Repositories } from "./repositories.js";

export type TransactionContext = Readonly<{
  repositories: Repositories;
  clock: DatabaseClock;
  outbox: OutboxWriter;
  audit: AuditWriter;
}>;

export type TransactionIsolation = "read committed" | "serializable";

export interface TransactionManager {
  run<T>(
    work: (tx: TransactionContext) => Promise<T>,
    options?: { isolation?: TransactionIsolation },
  ): Promise<T>;
}
