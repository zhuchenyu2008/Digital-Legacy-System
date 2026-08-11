import {
  type ExpireRecoveryResult,
  expireRecovery,
  type TransactionManager,
} from "@dls/application";
import { createPgPool, PgTransactionManager } from "@dls/persistence";
import { loadWorkerConfig } from "../config/load-config.js";
import type { WorkerJob } from "./register-handlers.js";

type Expire = (
  command: Readonly<{ workflowId: string; aggregateVersion: number }>,
) => Promise<ExpireRecoveryResult>;

export class RecoveryExpireHandler {
  public constructor(private readonly expire: Expire) {}

  public async handle(job: WorkerJob): Promise<void> {
    await this.expire({
      workflowId: job.data.aggregateId,
      aggregateVersion: job.data.aggregateVersion,
    });
  }
}

export function createRecoveryExpireHandler(): RecoveryExpireHandler {
  const transaction: TransactionManager = new PgTransactionManager(
    createPgPool({ connectionString: loadWorkerConfig().databaseUrl }),
  );
  return new RecoveryExpireHandler((command) => expireRecovery(command, { transaction }));
}
