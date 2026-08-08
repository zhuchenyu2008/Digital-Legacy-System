export type JobPayload = Readonly<{
  aggregateId: string;
  aggregateVersion: number;
}>;

export interface JobScheduler {
  schedule(
    jobName: string,
    payload: JobPayload,
    options?: Readonly<{ singletonKey?: string; retryLimit?: number }>,
  ): Promise<string | null>;
}
