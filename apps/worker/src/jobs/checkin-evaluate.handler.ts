import { evaluateCheckin, type TransactionManager } from "@dls/application";
import { createPgPool, PgTransactionManager } from "@dls/persistence";
import { loadWorkerConfig } from "../config/load-config.js";
import type { WorkerJob } from "./register-handlers.js";

export class CheckinEvaluateHandler {
  public constructor(private readonly transaction: TransactionManager) {}

  public async handle(job: WorkerJob): Promise<void> {
    await evaluateCheckin(
      {
        scheduleId: job.data.aggregateId,
        scheduleVersion: job.data.aggregateVersion,
      },
      { transaction: this.transaction },
    );
  }
}

export function createCheckinEvaluateHandler(): CheckinEvaluateHandler {
  const config = loadWorkerConfig();
  const pool = createPgPool({ connectionString: config.databaseUrl });
  return new CheckinEvaluateHandler(new PgTransactionManager(pool));
}
