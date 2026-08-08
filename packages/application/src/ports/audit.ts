export type AuditEvent = Readonly<{
  eventId: string;
  occurredAt: string;
  eventType: string;
  actorType: string;
  actorPseudonym?: Uint8Array;
  targetType?: string;
  targetId?: string;
  result: "SUCCESS" | "DENIED" | "FAILURE";
  requestId?: string;
  metadata?: Readonly<Record<string, unknown>>;
}>;

export interface AuditWriter {
  append(event: AuditEvent): Promise<void>;
}
