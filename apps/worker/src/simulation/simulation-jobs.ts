export const SIMULATION_JOB_NAMES = Object.freeze({
  ADVANCE: "simulation.advance",
  NOTIFICATION_DELIVER: "simulation.notification.deliver",
  PUBLICATION_FINALIZE: "simulation.publication.finalize",
} as const);

export type SimulationJobName = (typeof SIMULATION_JOB_NAMES)[keyof typeof SIMULATION_JOB_NAMES];

export function assertSimulationJobName(name: string): SimulationJobName {
  if (!(Object.values(SIMULATION_JOB_NAMES) as readonly string[]).includes(name)) {
    throw new Error("job is outside the simulation namespace");
  }
  return name as SimulationJobName;
}

export type SimulationWorkerJob = Readonly<{
  id: string;
  name: SimulationJobName;
  data: Readonly<{ simulationId: string; revision: number }>;
}>;

export type SimulationWorkerHandler = (job: SimulationWorkerJob) => Promise<void>;

export type SimulationWorkerBoss = Readonly<{
  work(
    name: string,
    options: Readonly<Record<string, unknown>>,
    handler: (jobs: readonly SimulationWorkerJob[]) => Promise<void>,
  ): Promise<unknown>;
}>;

export async function registerSimulationJobs(
  boss: SimulationWorkerBoss,
  handlers: Readonly<Partial<Record<SimulationJobName, SimulationWorkerHandler>>>,
): Promise<void> {
  for (const name of Object.values(SIMULATION_JOB_NAMES)) {
    const handler = handlers[name];
    if (handler === undefined) continue;
    await boss.work(name, { batchSize: 1 }, async (jobs) => {
      for (const job of jobs) await handler(job);
    });
  }
}
