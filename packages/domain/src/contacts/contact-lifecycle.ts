import { type Instant, isDue } from "../shared/instant.js";
import { createWorkflowEvent, type DomainEvent } from "../workflows/workflow-events.js";
import {
  immutableArray,
  immutableSnapshot,
  invalidTransition,
  type TransitionResult,
} from "../workflows/workflow-state.js";

export type ContactStatus = "INVITED" | "CONSENTED" | "ACTIVE" | "REMOVED";

export type ContactLifecycle = Readonly<{
  status: ContactStatus;
  invitationExpiresAt?: Instant;
}>;

export type ContactCommand =
  | Readonly<{ type: "CONSENT" }>
  | Readonly<{ type: "ACTIVATE" }>
  | Readonly<{ type: "REMOVE" }>
  | Readonly<{ type: "EXPIRE_INVITATION" }>;

export function transitionContactLifecycle(
  state: ContactLifecycle,
  command: ContactCommand,
  at: Instant,
): TransitionResult<ContactLifecycle, DomainEvent> {
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
  return {
    state: immutableSnapshot(state),
    events: immutableArray([createWorkflowEvent(eventType, at)]),
  };
}
