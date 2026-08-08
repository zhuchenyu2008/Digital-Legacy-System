import type { AggregateId } from "../shared/aggregate-id.js";
import { type Instant, isDue } from "../shared/instant.js";
import { assertPackageVersion, type PackageVersion } from "../shared/package-version.js";
import type { AggregateVersion } from "../shared/version.js";
import { createWorkflowEvent, type DomainEvent } from "./workflow-events.js";
import {
  assertExpectedVersion,
  immutableArray,
  immutableSnapshot,
  invalidTransition,
  nextVersion,
  type TransitionResult,
} from "./workflow-state.js";

export type ReleaseWorkflowState = "PENDING" | "LOCKED" | "RELEASED" | "CANCELLED";

export type ReleaseWorkflow = Readonly<{
  state: ReleaseWorkflowState;
  version: AggregateVersion;
  packageId: AggregateId;
  packageVersion: PackageVersion;
  releaseAt: Instant;
}>;

export type ReleaseCommand =
  | Readonly<{ type: "LOCK"; expectedVersion: AggregateVersion }>
  | Readonly<{ type: "FINALIZE"; expectedVersion: AggregateVersion }>
  | Readonly<{ type: "CANCEL"; expectedVersion: AggregateVersion }>;

export function transitionReleaseWorkflow(
  state: ReleaseWorkflow,
  command: ReleaseCommand,
  at: Instant,
): TransitionResult<ReleaseWorkflow, DomainEvent> {
  assertPackageVersion(state.packageVersion);
  assertExpectedVersion(state.version, command.expectedVersion);

  if (command.type === "LOCK") {
    if (state.state !== "PENDING") invalidTransition("release workflow", state.state, command.type);
    if (!isDue(at, state.releaseAt)) {
      throw new Error("Release deadline has not been reached");
    }
    const version = nextVersion(state.version);
    return {
      state: immutableSnapshot({ ...state, version, state: "LOCKED" }),
      events: immutableArray([createWorkflowEvent("RELEASE_LOCKED", at, version)]),
    };
  }

  if (command.type === "FINALIZE") {
    if (state.state !== "LOCKED") invalidTransition("release workflow", state.state, command.type);
    const version = nextVersion(state.version);
    return {
      state: immutableSnapshot({ ...state, version, state: "RELEASED" }),
      events: immutableArray([createWorkflowEvent("RELEASE_FINALIZED", at, version)]),
    };
  }

  if (state.state !== "PENDING") invalidTransition("release workflow", state.state, command.type);
  if (isDue(at, state.releaseAt)) {
    throw new Error("Release deadline has passed; cancellation is permanently locked");
  }
  const version = nextVersion(state.version);
  return {
    state: immutableSnapshot({ ...state, version, state: "CANCELLED" }),
    events: immutableArray([createWorkflowEvent("RELEASE_CANCELLED", at, version)]),
  };
}
