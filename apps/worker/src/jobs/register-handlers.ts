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

export type WorkerDrain = Readonly<{
  stopAccepting(): void;
  run<T>(task: () => Promise<T>): Promise<T>;
  waitForIdle(timeoutMs: number): Promise<void>;
  activeCount(): number;
}>;

export function createWorkerDrain(): WorkerDrain {
  let accepting = true;
  let active = 0;
  let idleResolvers: Array<() => void> = [];

  const notifyIdle = () => {
    if (active !== 0) return;
    const resolvers = idleResolvers;
    idleResolvers = [];
    for (const resolve of resolvers) resolve();
  };

  return {
    stopAccepting() {
      accepting = false;
    },
    async run<T>(task: () => Promise<T>): Promise<T> {
      if (!accepting) throw new Error("Worker is draining and no longer accepts tasks");
      active += 1;
      try {
        return await task();
      } finally {
        active -= 1;
        notifyIdle();
      }
    },
    async waitForIdle(timeoutMs: number): Promise<void> {
      if (active === 0) return;
      await Promise.race([
        new Promise<void>((resolve) => idleResolvers.push(resolve)),
        new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
      ]);
    },
    activeCount() {
      return active;
    },
  };
}

export async function registerJobHandlers(
  boss: WorkerBoss,
  handlers: Readonly<Partial<Record<JobName, WorkerJobHandler>>>,
  drain: WorkerDrain = createWorkerDrain(),
): Promise<void> {
  for (const name of Object.values(JOB_NAMES)) {
    const handler = handlers[name];
    if (handler === undefined) continue;
    await boss.work(name, { batchSize: 1 }, async (jobs) => {
      for (const job of jobs) await drain.run(() => handler(job));
    });
  }
}
