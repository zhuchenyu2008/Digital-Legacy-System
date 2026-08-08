import type { JobPayload, JobScheduler } from "@dls/application";

import type { JobName } from "./job-names.js";

export type PgBossLike = Readonly<{
  send(
    name: string,
    payload: JobPayload,
    options?: Readonly<Record<string, unknown>>,
  ): Promise<string | null>;
}>;

export class PgBossScheduler implements JobScheduler {
  readonly #boss: PgBossLike;

  constructor(boss: PgBossLike) {
    this.#boss = boss;
  }

  async schedule(
    jobName: JobName | string,
    payload: JobPayload,
    options?: Readonly<{ singletonKey?: string; retryLimit?: number }>,
  ): Promise<string | null> {
    if (!Number.isSafeInteger(payload.aggregateVersion) || payload.aggregateVersion < 0) {
      throw new RangeError("Job payload aggregateVersion must be a nonnegative safe integer");
    }
    return this.#boss.send(jobName, payload, {
      singletonKey:
        options?.singletonKey ?? `${jobName}:${payload.aggregateId}:${payload.aggregateVersion}`,
      retryLimit: options?.retryLimit ?? 7,
    });
  }
}
