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

export type RecoveryWorkflowState =
  | "AWAITING_APPROVALS"
  | "REWRAP_PENDING"
  | "COMPLETED"
  | "CANCELLED"
  | "EXPIRED";

export type RecoveryWorkflow = Readonly<{
  state: RecoveryWorkflowState;
  version: AggregateVersion;
  contactIds: readonly AggregateId[];
  requiredApprovals: number;
  approvedContactIds: readonly AggregateId[];
  approvedCount: number;
  expiresAt: Instant;
  shareGenerationId: AggregateId;
}>;

export type RecoveryCommand =
  | Readonly<{ type: "APPROVE"; contactId: AggregateId; expectedVersion: AggregateVersion }>
  | Readonly<{ type: "COMPLETE"; expectedVersion: AggregateVersion }>
  | Readonly<{ type: "CANCEL"; expectedVersion: AggregateVersion }>
  | Readonly<{ type: "EXPIRE"; expectedVersion: AggregateVersion }>
  | Readonly<{
      type: "CHANGE_THRESHOLD";
      requiredApprovals: number;
      expectedVersion: AggregateVersion;
    }>;

export function transitionRecoveryWorkflow(
  state: RecoveryWorkflow,
  command: RecoveryCommand,
  at: Instant,
): TransitionResult<RecoveryWorkflow, DomainEvent> {
  assertSnapshot(state);
  assertExpectedVersion(state.version, command.expectedVersion);

  if (command.type === "CHANGE_THRESHOLD") {
    throw new Error("Workflow snapshot is immutable: threshold cannot change");
  }

  if (command.type === "APPROVE") {
    if (state.state !== "AWAITING_APPROVALS") {
      invalidTransition("recovery workflow", state.state, command.type);
    }
    if (isDue(at, state.expiresAt)) {
      throw new Error("Recovery workflow deadline has passed");
    }
    if (!state.contactIds.includes(command.contactId)) {
      throw new Error("Contact is not in workflow snapshot");
    }
    if (state.approvedContactIds.includes(command.contactId)) {
      throw new Error("Contact has already acted in this workflow");
    }
    const approvedContactIds = immutableArray([...state.approvedContactIds, command.contactId]);
    const version = nextVersion(state.version);
    const nextState: RecoveryWorkflow = {
      ...state,
      version,
      approvedContactIds,
      approvedCount: approvedContactIds.length,
      state:
        approvedContactIds.length >= state.requiredApprovals
          ? "REWRAP_PENDING"
          : "AWAITING_APPROVALS",
    };
    const events = [createWorkflowEvent("RECOVERY_APPROVAL_RECORDED", at, version)];
    if (nextState.state === "REWRAP_PENDING") {
      events.push(createWorkflowEvent("RECOVERY_REWRAP_PENDING", at, version));
    }
    return {
      state: immutableRecoveryWorkflow(nextState),
      events: immutableArray(events),
    };
  }

  if (command.type === "COMPLETE") {
    if (state.state !== "REWRAP_PENDING") {
      invalidTransition("recovery workflow", state.state, command.type);
    }
    const version = nextVersion(state.version);
    return {
      state: immutableRecoveryWorkflow({ ...state, version, state: "COMPLETED" }),
      events: immutableArray([createWorkflowEvent("RECOVERY_COMPLETED", at, version)]),
    };
  }

  if (command.type === "EXPIRE") {
    if (state.state !== "AWAITING_APPROVALS" && state.state !== "REWRAP_PENDING") {
      invalidTransition("recovery workflow", state.state, command.type);
    }
    if (!isDue(at, state.expiresAt)) {
      throw new Error("Recovery workflow deadline has not been reached");
    }
    const version = nextVersion(state.version);
    return {
      state: immutableRecoveryWorkflow({ ...state, version, state: "EXPIRED" }),
      events: immutableArray([createWorkflowEvent("RECOVERY_EXPIRED", at, version)]),
    };
  }

  if (state.state !== "AWAITING_APPROVALS" && state.state !== "REWRAP_PENDING") {
    invalidTransition("recovery workflow", state.state, command.type);
  }
  const version = nextVersion(state.version);
  return {
    state: immutableRecoveryWorkflow({ ...state, version, state: "CANCELLED" }),
    events: immutableArray([createWorkflowEvent("RECOVERY_CANCELLED", at, version)]),
  };
}

function immutableRecoveryWorkflow(state: RecoveryWorkflow): RecoveryWorkflow {
  return immutableSnapshot({
    ...state,
    contactIds: immutableArray(state.contactIds),
    approvedContactIds: immutableArray(state.approvedContactIds),
  });
}

function assertSnapshot(state: RecoveryWorkflow): void {
  if (
    state.contactIds.length < 1 ||
    new Set(state.contactIds).size !== state.contactIds.length ||
    !Number.isSafeInteger(state.requiredApprovals) ||
    state.requiredApprovals < 1 ||
    state.requiredApprovals > state.contactIds.length ||
    state.approvedCount !== state.approvedContactIds.length ||
    state.approvedContactIds.some((id) => !state.contactIds.includes(id))
  ) {
    throw new Error("Invalid workflow snapshot");
  }
}
