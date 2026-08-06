import { computeReleaseDeadline } from "../policies/release-policy.js";
import type { AggregateId } from "../shared/aggregate-id.js";
import { type Instant, isDue } from "../shared/instant.js";
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

export type DeathWorkflowState =
  | "AWAITING_CONFIRMATIONS"
  | "GRACE_PERIOD"
  | "RELEASE_PENDING"
  | "RELEASED"
  | "CANCELLED";

export type DeathWorkflow = Readonly<{
  state: DeathWorkflowState;
  version: AggregateVersion;
  contactIds: readonly AggregateId[];
  requiredConfirmations: number;
  approvedContactIds: readonly AggregateId[];
  approvedCount: number;
  shareGenerationId: AggregateId;
  packageId: AggregateId;
  graceDeadline: Instant;
  releaseDelayDays: number;
  releaseAt?: Instant;
  endedAt?: Instant;
  endReason?: string;
}>;

export type DeathCommand =
  | Readonly<{ type: "CONFIRM_DEATH"; contactId: AggregateId; expectedVersion: AggregateVersion }>
  | Readonly<{ type: "BEGIN_RELEASE"; expectedVersion: AggregateVersion }>
  | Readonly<{ type: "FINALIZE_RELEASE"; expectedVersion: AggregateVersion }>
  | Readonly<{ type: "CANCEL"; reason: string; expectedVersion: AggregateVersion }>
  | Readonly<{
      type: "CHANGE_THRESHOLD";
      requiredConfirmations: number;
      expectedVersion: AggregateVersion;
    }>;

export function transitionDeathWorkflow(
  state: DeathWorkflow,
  command: DeathCommand,
  at: Instant,
): TransitionResult<DeathWorkflow, DomainEvent> {
  assertSnapshot(state);
  assertExpectedVersion(state.version, command.expectedVersion);

  if (command.type === "CHANGE_THRESHOLD") {
    throw new Error("Workflow snapshot is immutable: threshold cannot change");
  }

  if (command.type === "CONFIRM_DEATH") {
    if (state.state !== "AWAITING_CONFIRMATIONS") {
      invalidTransition("death workflow", state.state, command.type);
    }
    if (!state.contactIds.includes(command.contactId)) {
      throw new Error("Contact is not in workflow snapshot");
    }
    if (state.approvedContactIds.includes(command.contactId)) {
      throw new Error("Contact has already acted in this workflow");
    }

    const approvedContactIds = immutableArray([...state.approvedContactIds, command.contactId]);
    const version = nextVersion(state.version);
    const nextState: DeathWorkflow = {
      ...state,
      version,
      approvedContactIds,
      approvedCount: approvedContactIds.length,
      state:
        approvedContactIds.length >= state.requiredConfirmations
          ? "GRACE_PERIOD"
          : "AWAITING_CONFIRMATIONS",
    };
    const events = [createWorkflowEvent("DEATH_CONFIRMATION_RECORDED", at, version)];
    if (nextState.state === "GRACE_PERIOD") {
      events.push(createWorkflowEvent("DEATH_GRACE_STARTED", at, version));
    }
    return {
      state: immutableDeathWorkflow(nextState),
      events: immutableArray(events),
    };
  }

  if (command.type === "BEGIN_RELEASE") {
    if (state.state !== "GRACE_PERIOD") {
      invalidTransition("death workflow", state.state, command.type);
    }
    if (!isDue(at, state.graceDeadline)) {
      throw new Error("Grace period deadline has not been reached");
    }
    const version = nextVersion(state.version);
    const releaseAt = computeReleaseDeadline(state.graceDeadline, state.releaseDelayDays);
    return {
      state: immutableDeathWorkflow({ ...state, version, state: "RELEASE_PENDING", releaseAt }),
      events: immutableArray([createWorkflowEvent("DEATH_RELEASE_PENDING", at, version)]),
    };
  }

  if (command.type === "FINALIZE_RELEASE") {
    if (state.state !== "RELEASE_PENDING" || state.releaseAt === undefined) {
      invalidTransition("death workflow", state.state, command.type);
    }
    if (!isDue(at, state.releaseAt)) {
      throw new Error("Release deadline has not been reached");
    }
    const version = nextVersion(state.version);
    return {
      state: immutableDeathWorkflow({ ...state, version, state: "RELEASED", endedAt: at }),
      events: immutableArray([createWorkflowEvent("DEATH_RELEASED", at, version)]),
    };
  }

  if (
    state.state === "RELEASE_PENDING" &&
    state.releaseAt !== undefined &&
    isDue(at, state.releaseAt)
  ) {
    throw new Error("Release deadline has passed; cancellation is permanently locked");
  }
  if (
    state.state !== "AWAITING_CONFIRMATIONS" &&
    state.state !== "GRACE_PERIOD" &&
    state.state !== "RELEASE_PENDING"
  ) {
    invalidTransition("death workflow", state.state, command.type);
  }
  const version = nextVersion(state.version);
  return {
    state: immutableDeathWorkflow({
      ...state,
      version,
      state: "CANCELLED",
      endedAt: at,
      endReason: command.reason,
    }),
    events: immutableArray([createWorkflowEvent("DEATH_WORKFLOW_CANCELLED", at, version)]),
  };
}

function immutableDeathWorkflow(state: DeathWorkflow): DeathWorkflow {
  return immutableSnapshot({
    ...state,
    contactIds: immutableArray(state.contactIds),
    approvedContactIds: immutableArray(state.approvedContactIds),
  });
}

function assertSnapshot(state: DeathWorkflow): void {
  if (
    state.contactIds.length < 1 ||
    new Set(state.contactIds).size !== state.contactIds.length ||
    !Number.isSafeInteger(state.requiredConfirmations) ||
    state.requiredConfirmations < 1 ||
    state.requiredConfirmations > state.contactIds.length ||
    state.approvedCount !== state.approvedContactIds.length ||
    state.approvedContactIds.some((id) => !state.contactIds.includes(id))
  ) {
    throw new Error("Invalid workflow snapshot");
  }
}
