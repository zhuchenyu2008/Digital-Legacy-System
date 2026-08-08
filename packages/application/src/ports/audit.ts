export type AuditEvent = Readonly<{
  eventId: string;
  occurredAt: string;
  eventType: string;
  actorType: string;
  actorIdDigest?: Uint8Array;
  actorPseudonym?: Uint8Array;
  aggregateType?: string;
  aggregateId?: string;
  payload?: Readonly<Record<string, unknown>>;
  targetType?: string;
  targetId?: string;
  result: "SUCCESS" | "DENIED" | "FAILURE";
  requestId?: string;
  metadata?: Readonly<Record<string, unknown>>;
}>;

export interface AuditWriter {
  append(event: AuditEvent): Promise<void>;
}
