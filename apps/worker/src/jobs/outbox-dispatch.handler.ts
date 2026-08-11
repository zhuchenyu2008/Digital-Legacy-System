import type { WorkerJob } from "./register-handlers.js";

/**
 * Acknowledges observational domain events after the dispatcher has reduced
 * their payload to the non-secret aggregate identity. Operational events are
 * routed to dedicated handlers before they can reach this consumer.
 */
export class OutboxDispatchHandler {
  public async handle(job: WorkerJob): Promise<void> {
    if (
      job.data.aggregateId.length === 0 ||
      !Number.isSafeInteger(job.data.aggregateVersion) ||
      job.data.aggregateVersion < 0
    ) {
      throw new Error("Outbox event identity is invalid");
    }
  }
}
