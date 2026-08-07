import type { Instant } from "../shared/instant.js";
import type { AggregateVersion } from "../shared/version.js";
import type { WorkflowEvent } from "./workflow-state.js";

export type WorkflowEventType =
  | "CONTACT_CONSENTED"
  | "CONTACT_ACTIVATED"
  | "CONTACT_REMOVED"
  | "CONTACT_INVITATION_EXPIRED"
  | "SHARE_DISTRIBUTION_STARTED"
  | "SHARE_GENERATION_ACTIVATED"
  | "SHARE_GENERATION_SUPERSEDED"
  | "SHARE_GENERATION_FAILED"
  | "PACKAGE_VALIDATION_STARTED"
  | "PACKAGE_READY"
  | "PACKAGE_ACTIVATED"
  | "PACKAGE_SUPERSEDED"
  | "PACKAGE_FAILED"
  | "PACKAGE_ABORTED"
  | "DEATH_CONFIRMATION_RECORDED"
  | "DEATH_GRACE_STARTED"
  | "DEATH_RELEASE_PENDING"
  | "DEATH_RELEASED"
  | "DEATH_WORKFLOW_CANCELLED"
  | "RECOVERY_APPROVAL_RECORDED"
  | "RECOVERY_REWRAP_PENDING"
  | "RECOVERY_COMPLETED"
  | "RECOVERY_CANCELLED"
  | "RECOVERY_EXPIRED"
  | "RELEASE_LOCKED"
  | "RELEASE_FINALIZED"
  | "RELEASE_CANCELLED";

export type DomainEvent = WorkflowEvent & Readonly<{ type: WorkflowEventType }>;

export function createWorkflowEvent(
  type: WorkflowEventType,
  occurredAt: Instant,
  aggregateVersion?: AggregateVersion,
  payload?: Readonly<Record<string, string | number>>,
): DomainEvent {
  const frozenPayload = payload === undefined ? undefined : Object.freeze({ ...payload });

  return Object.freeze({
    type,
    occurredAt,
    ...(aggregateVersion === undefined ? {} : { aggregateVersion }),
    ...(frozenPayload === undefined ? {} : { payload: frozenPayload }),
  });
}
