export type OutboxEvent = Readonly<{
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: Readonly<Record<string, unknown>>;
  idempotencyKey: string;
  availableAt?: string;
}>;

export type OutboxRecord = Readonly<OutboxEvent & { id: string }>;

export interface OutboxWriter {
  enqueue(event: OutboxEvent): Promise<OutboxRecord>;
}
