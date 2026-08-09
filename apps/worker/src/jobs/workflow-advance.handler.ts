import {
  type AdvanceReleaseResult,
  advanceRelease,
  ReleaseAdvanceCriticalError,
} from "@dls/application";
import { createPgPool, PgTransactionManager } from "@dls/persistence";
import { loadWorkerKeyCapabilities } from "../config/key-capabilities.js";
import { loadWorkerConfig } from "../config/load-config.js";
import { WorkerStageKeys } from "./process-release-fragment.handler.js";
import type { WorkerJob } from "./register-handlers.js";

type Advance = (
  command: Readonly<{ workflowId: string; aggregateVersion: number }>,
) => Promise<AdvanceReleaseResult>;

type CriticalReporter = (error: ReleaseAdvanceCriticalError) => void;

function reportCritical(error: ReleaseAdvanceCriticalError): void {
  process.stderr.write(
    `${JSON.stringify({
      level: "critical",
      event: "release_stage_key_unavailable",
      code: error.code,
      severity: error.severity,
      retryable: error.retryable,
    })}\n`,
  );
}

export class WorkflowAdvanceHandler {
  public constructor(
    private readonly advance: Advance,
    private readonly criticalReporter: CriticalReporter = reportCritical,
  ) {}

  public async handle(job: WorkerJob): Promise<void> {
    try {
      await this.advance({
        workflowId: job.data.aggregateId,
        aggregateVersion: job.data.aggregateVersion,
      });
    } catch (error) {
      if (error instanceof ReleaseAdvanceCriticalError) this.criticalReporter(error);
      throw error;
    }
  }
}

export async function createWorkflowAdvanceHandler(): Promise<WorkflowAdvanceHandler> {
  const config = loadWorkerConfig();
  const transaction = new PgTransactionManager(
    createPgPool({ connectionString: config.databaseUrl }),
  );
  const stageKeys = new WorkerStageKeys(await loadWorkerKeyCapabilities());
  return new WorkflowAdvanceHandler((command) =>
    advanceRelease(command, { transaction, stageKeys }),
  );
}
