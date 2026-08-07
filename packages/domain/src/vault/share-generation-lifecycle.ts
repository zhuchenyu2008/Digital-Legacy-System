import type { Instant } from "../shared/instant.js";
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

export type ShareGenerationStatus = "DRAFT" | "DISTRIBUTING" | "ACTIVE" | "SUPERSEDED" | "FAILED";

export type ShareGenerationLifecycle = Readonly<{
  status: ShareGenerationStatus;
  version: AggregateVersion;
  failureReason?: string;
}>;

export type ShareGenerationCommand =
  | Readonly<{ type: "START_DISTRIBUTION"; expectedVersion: AggregateVersion }>
  | Readonly<{ type: "ACTIVATE"; expectedVersion: AggregateVersion }>
  | Readonly<{ type: "SUPERSEDE"; expectedVersion: AggregateVersion }>
  | Readonly<{ type: "FAIL"; reason: string; expectedVersion: AggregateVersion }>;

export function transitionShareGenerationLifecycle(
  state: ShareGenerationLifecycle,
  command: ShareGenerationCommand,
  at: Instant,
): TransitionResult<ShareGenerationLifecycle, DomainEvent> {
  assertExpectedVersion(state.version, command.expectedVersion);

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
  const version = nextVersion(state.version);
  return {
    state: immutableSnapshot({ ...state, version }),
    events: immutableArray([createWorkflowEvent(type, at, version)]),
  };
}
