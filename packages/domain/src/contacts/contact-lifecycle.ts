import { type Instant, isDue } from "../shared/instant.js";
import type { AggregateVersion } from "../shared/version.js";
import { createWorkflowEvent, type DomainEvent } from "../workflows/workflow-events.js";
import {
  assertExpectedVersion,
  immutableArray,
  immutableSnapshot,
  invalidTransition,
  nextVersion,
  type TransitionResult,
} from "../workflows/workflow-state.js";

export type ContactStatus = "INVITED" | "CONSENTED" | "ACTIVE" | "REMOVED";

export type ContactLifecycle = Readonly<{
  status: ContactStatus;
  version: AggregateVersion;
  invitationExpiresAt?: Instant;
}>;

export type ContactCommand =
  | Readonly<{ type: "CONSENT"; expectedVersion: AggregateVersion }>
  | Readonly<{ type: "ACTIVATE"; expectedVersion: AggregateVersion }>
  | Readonly<{ type: "REMOVE"; expectedVersion: AggregateVersion }>
  | Readonly<{ type: "EXPIRE_INVITATION"; expectedVersion: AggregateVersion }>;

export function transitionContactLifecycle(
  state: ContactLifecycle,
  command: ContactCommand,
  at: Instant,
): TransitionResult<ContactLifecycle, DomainEvent> {
  assertExpectedVersion(state.version, command.expectedVersion);

  if (command.type === "CONSENT") {
    if (state.status !== "INVITED") {
      invalidTransition("contact", state.status, command.type);
    }
    if (state.invitationExpiresAt === undefined || isDue(at, state.invitationExpiresAt)) {
      throw new Error("Contact invitation has expired");
    }
    return result({ ...state, status: "CONSENTED" }, "CONTACT_CONSENTED", at);
  }

  if (command.type === "EXPIRE_INVITATION") {
    if (state.status !== "INVITED") {
      invalidTransition("contact", state.status, command.type);
    }
    if (state.invitationExpiresAt === undefined || !isDue(at, state.invitationExpiresAt)) {
      throw new Error("Contact invitation deadline has not been reached");
    }
    return result({ ...state, status: "REMOVED" }, "CONTACT_INVITATION_EXPIRED", at);
  }

  if (command.type === "ACTIVATE") {
    if (state.status !== "CONSENTED") {
      invalidTransition("contact", state.status, command.type);
    }
    return result({ ...state, status: "ACTIVE" }, "CONTACT_ACTIVATED", at);
  }

  if (state.status !== "ACTIVE") {
    invalidTransition("contact", state.status, command.type);
  }
  return result({ ...state, status: "REMOVED" }, "CONTACT_REMOVED", at);
}

function result(
  state: ContactLifecycle,
  eventType:
    | "CONTACT_CONSENTED"
    | "CONTACT_ACTIVATED"
    | "CONTACT_REMOVED"
    | "CONTACT_INVITATION_EXPIRED",
  at: Instant,
): TransitionResult<ContactLifecycle, DomainEvent> {
  const version = nextVersion(state.version);
  return {
    state: immutableSnapshot({ ...state, version }),
    events: immutableArray([createWorkflowEvent(eventType, at, version)]),
  };
}
