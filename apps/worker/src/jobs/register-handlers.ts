import { JOB_NAMES, type JobName } from "@dls/persistence";

export type WorkerJob = Readonly<{
  id: string;
  name: JobName;
  data: Readonly<{
    aggregateId: string;
    aggregateVersion: number;
    eventId?: string;
    eventType?: string;
    contactId?: string;
    offsetMs?: number;
  }>;
}>;

export type WorkerJobHandler = (job: WorkerJob) => Promise<void>;

export type WorkerBoss = Readonly<{
  work(
    name: string,
    options: Readonly<Record<string, unknown>>,
    handler: (jobs: readonly WorkerJob[]) => Promise<void>,
  ): Promise<unknown>;
}>;

export async function registerJobHandlers(
  boss: WorkerBoss,
  handlers: Readonly<Partial<Record<JobName, WorkerJobHandler>>>,
): Promise<void> {
  for (const name of Object.values(JOB_NAMES)) {
    const handler = handlers[name];
    if (handler === undefined) continue;
    await boss.work(name, { batchSize: 1 }, async (jobs) => {
      for (const job of jobs) await handler(job);
    });
  }
}
