import type { Instant } from "../shared/instant.js";
import { createWorkflowEvent, type DomainEvent } from "../workflows/workflow-events.js";
import {
  immutableArray,
  immutableSnapshot,
  invalidTransition,
  type TransitionResult,
} from "../workflows/workflow-state.js";

export type ShareGenerationStatus = "DRAFT" | "DISTRIBUTING" | "ACTIVE" | "SUPERSEDED" | "FAILED";

export type ShareGenerationLifecycle = Readonly<{
  status: ShareGenerationStatus;
  failureReason?: string;
}>;

export type ShareGenerationCommand =
  | Readonly<{ type: "START_DISTRIBUTION" }>
  | Readonly<{ type: "ACTIVATE" }>
  | Readonly<{ type: "SUPERSEDE" }>
  | Readonly<{ type: "FAIL"; reason: string }>;

export function transitionShareGenerationLifecycle(
  state: ShareGenerationLifecycle,
  command: ShareGenerationCommand,
  at: Instant,
): TransitionResult<ShareGenerationLifecycle, DomainEvent> {
  if (command.type === "START_DISTRIBUTION") {
    if (state.status !== "DRAFT") invalidTransition("share generation", state.status, command.type);
    return result({ ...state, status: "DISTRIBUTING" }, "SHARE_DISTRIBUTION_STARTED", at);
  }

  if (command.type === "ACTIVATE") {
    if (state.status !== "DISTRIBUTING")
      invalidTransition("share generation", state.status, command.type);
    return result({ ...state, status: "ACTIVE" }, "SHARE_GENERATION_ACTIVATED", at);
  }

  if (command.type === "SUPERSEDE") {
    if (state.status !== "ACTIVE")
      invalidTransition("share generation", state.status, command.type);
    return result({ ...state, status: "SUPERSEDED" }, "SHARE_GENERATION_SUPERSEDED", at);
  }

  if (state.status !== "DRAFT" && state.status !== "DISTRIBUTING") {
    invalidTransition("share generation", state.status, command.type);
  }
  return result(
    { ...state, status: "FAILED", failureReason: command.reason },
    "SHARE_GENERATION_FAILED",
    at,
  );
}

function result(
  state: ShareGenerationLifecycle,
  type:
    | "SHARE_DISTRIBUTION_STARTED"
    | "SHARE_GENERATION_ACTIVATED"
    | "SHARE_GENERATION_SUPERSEDED"
    | "SHARE_GENERATION_FAILED",
  at: Instant,
): TransitionResult<ShareGenerationLifecycle, DomainEvent> {
  return {
    state: immutableSnapshot(state),
    events: immutableArray([createWorkflowEvent(type, at)]),
  };
}
