import type { AggregateId } from "../shared/aggregate-id.js";
import type { Instant } from "../shared/instant.js";
import { createWorkflowEvent, type DomainEvent } from "../workflows/workflow-events.js";
import {
  immutableArray,
  immutableSnapshot,
  invalidTransition,
  type TransitionResult,
} from "../workflows/workflow-state.js";

export type PackageStatus =
  | "UPLOADING"
  | "VALIDATING"
  | "READY"
  | "ACTIVE"
  | "SUPERSEDED"
  | "FAILED"
  | "ABORTED";

export type PackageLifecycle = Readonly<{
  status: PackageStatus;
  packageId?: AggregateId;
  failureReason?: string;
}>;

export type PackageCommand =
  | Readonly<{ type: "START_VALIDATION" }>
  | Readonly<{ type: "MARK_READY" }>
  | Readonly<{ type: "ACTIVATE"; packageId: AggregateId }>
  | Readonly<{ type: "SUPERSEDE" }>
  | Readonly<{ type: "FAIL"; reason: string }>
  | Readonly<{ type: "ABORT" }>;

export function transitionPackageLifecycle(
  state: PackageLifecycle,
  command: PackageCommand,
  at: Instant,
): TransitionResult<PackageLifecycle, DomainEvent> {
  if (command.type === "START_VALIDATION") {
    if (state.status !== "UPLOADING") invalidTransition("package", state.status, command.type);
    return result({ ...state, status: "VALIDATING" }, "PACKAGE_VALIDATION_STARTED", at);
  }

  if (command.type === "MARK_READY") {
    if (state.status !== "VALIDATING") invalidTransition("package", state.status, command.type);
    return result({ ...state, status: "READY" }, "PACKAGE_READY", at);
  }

  if (command.type === "ACTIVATE") {
    if (state.status !== "READY") invalidTransition("package", state.status, command.type);
    return result(
      { ...state, status: "ACTIVE", packageId: command.packageId },
      "PACKAGE_ACTIVATED",
      at,
    );
  }

  if (command.type === "SUPERSEDE") {
    if (state.status !== "ACTIVE") invalidTransition("package", state.status, command.type);
    return result({ ...state, status: "SUPERSEDED" }, "PACKAGE_SUPERSEDED", at);
  }

  if (command.type === "FAIL") {
    if (state.status !== "UPLOADING" && state.status !== "VALIDATING" && state.status !== "READY") {
      invalidTransition("package", state.status, command.type);
    }
    return result(
      { ...state, status: "FAILED", failureReason: command.reason },
      "PACKAGE_FAILED",
      at,
    );
  }

  if (state.status !== "UPLOADING" && state.status !== "VALIDATING" && state.status !== "READY") {
    invalidTransition("package", state.status, command.type);
  }
  return result({ ...state, status: "ABORTED" }, "PACKAGE_ABORTED", at);
}

function result(
  state: PackageLifecycle,
  type:
    | "PACKAGE_VALIDATION_STARTED"
    | "PACKAGE_READY"
    | "PACKAGE_ACTIVATED"
    | "PACKAGE_SUPERSEDED"
    | "PACKAGE_FAILED"
    | "PACKAGE_ABORTED",
  at: Instant,
): TransitionResult<PackageLifecycle, DomainEvent> {
  return {
    state: immutableSnapshot(state),
    events: immutableArray([createWorkflowEvent(type, at)]),
  };
}
