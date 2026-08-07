import { describe, expect, test } from "vitest";
import {
  type ContactCommand,
  type ContactLifecycle,
  type ContactStatus,
  transitionContactLifecycle,
} from "../contacts/contact-lifecycle.js";
import { parseAggregateId } from "../shared/aggregate-id.js";
import { type Instant, parseInstant } from "../shared/instant.js";
import { parseAggregateVersion } from "../shared/version.js";
import {
  type PackageCommand,
  type PackageLifecycle,
  type PackageStatus,
  transitionPackageLifecycle,
} from "../vault/package-lifecycle.js";
import {
  type ShareGenerationCommand,
  type ShareGenerationLifecycle,
  type ShareGenerationStatus,
  transitionShareGenerationLifecycle,
} from "../vault/share-generation-lifecycle.js";
import {
  type DeathCommand,
  type DeathWorkflow,
  type DeathWorkflowState,
  transitionDeathWorkflow,
} from "./death-workflow.js";
import {
  type RecoveryCommand,
  type RecoveryWorkflow,
  type RecoveryWorkflowState,
  transitionRecoveryWorkflow,
} from "./recovery-workflow.js";
import {
  type ReleaseCommand,
  type ReleaseWorkflow,
  type ReleaseWorkflowState,
  transitionReleaseWorkflow,
} from "./release-workflow.js";

const beforeDeadline = parseInstant("2026-08-06T12:00:00Z");
const invitationDeadline = parseInstant("2026-08-07T12:00:00Z");
const recoveryDeadline = parseInstant("2026-08-13T12:00:00Z");
const releaseDeadline = parseInstant("2026-08-08T12:00:00Z");
const versionZero = parseAggregateVersion(0);
const contactA = parseAggregateId("01890a5d-ac96-7cc3-98c9-0bb31376f242");
const contactB = parseAggregateId("01890a5d-ac96-7cc3-98c9-0bb31376f243");
const contactC = parseAggregateId("01890a5d-ac96-7cc3-98c9-0bb31376f244");
const packageId = parseAggregateId("01890a5d-ac96-7cc3-98c9-0bb31376f245");
const shareGenerationId = parseAggregateId("01890a5d-ac96-7cc3-98c9-0bb31376f246");

type MatrixCommand<C> = Readonly<{ command: C; at: Instant }>;

function assertCartesianMatrix<S extends string, C extends { readonly type: string }>(options: {
  scope: string;
  states: readonly S[];
  commands: readonly MatrixCommand<C>[];
  allowed: Readonly<Record<S, readonly C["type"][]>>;
  createState: (state: S) => unknown;
  transition: (state: never, command: C, at: Instant) => unknown;
}): void {
  for (const stateName of options.states) {
    for (const entry of options.commands) {
      const isAllowed = options.allowed[stateName].includes(entry.command.type);
      test(`${options.scope}: ${stateName} -> ${entry.command.type} is ${isAllowed ? "allowed" : "rejected"}`, () => {
        const invoke = () =>
          options.transition(options.createState(stateName) as never, entry.command, entry.at);

        if (isAllowed) {
          expect(invoke).not.toThrow();
        } else {
          expect(invoke).toThrow();
        }
      });
    }
  }
}

describe("complete state-command transition matrices", () => {
  describe("contact lifecycle", () => {
    const states: readonly ContactStatus[] = ["INVITED", "CONSENTED", "ACTIVE", "REMOVED"];
    const commands: readonly MatrixCommand<ContactCommand>[] = [
      {
        command: { type: "CONSENT", expectedVersion: versionZero },
        at: beforeDeadline,
      },
      {
        command: { type: "ACTIVATE", expectedVersion: versionZero },
        at: beforeDeadline,
      },
      {
        command: { type: "REMOVE", expectedVersion: versionZero },
        at: beforeDeadline,
      },
      {
        command: { type: "EXPIRE_INVITATION", expectedVersion: versionZero },
        at: invitationDeadline,
      },
    ];

    assertCartesianMatrix({
      scope: "contact",
      states,
      commands,
      allowed: {
        INVITED: ["CONSENT", "EXPIRE_INVITATION"],
        CONSENTED: ["ACTIVATE"],
        ACTIVE: ["REMOVE"],
        REMOVED: [],
      },
      createState: (status): ContactLifecycle => ({
        status,
        version: versionZero,
        invitationExpiresAt: invitationDeadline,
      }),
      transition: transitionContactLifecycle,
    });
  });

  describe("share-generation lifecycle", () => {
    const states: readonly ShareGenerationStatus[] = [
      "DRAFT",
      "DISTRIBUTING",
      "ACTIVE",
      "SUPERSEDED",
      "FAILED",
    ];
    const commands: readonly MatrixCommand<ShareGenerationCommand>[] = [
      {
        command: { type: "START_DISTRIBUTION", expectedVersion: versionZero },
        at: beforeDeadline,
      },
      { command: { type: "ACTIVATE", expectedVersion: versionZero }, at: beforeDeadline },
      { command: { type: "SUPERSEDE", expectedVersion: versionZero }, at: beforeDeadline },
      {
        command: { type: "FAIL", reason: "matrix", expectedVersion: versionZero },
        at: beforeDeadline,
      },
    ];

    assertCartesianMatrix({
      scope: "share generation",
      states,
      commands,
      allowed: {
        DRAFT: ["START_DISTRIBUTION", "FAIL"],
        DISTRIBUTING: ["ACTIVATE", "FAIL"],
        ACTIVE: ["SUPERSEDE"],
        SUPERSEDED: [],
        FAILED: [],
      },
      createState: (status): ShareGenerationLifecycle => ({ status, version: versionZero }),
      transition: transitionShareGenerationLifecycle,
    });
  });

  describe("package lifecycle", () => {
    const states: readonly PackageStatus[] = [
      "UPLOADING",
      "VALIDATING",
      "READY",
      "ACTIVE",
      "SUPERSEDED",
      "FAILED",
      "ABORTED",
    ];
    const commands: readonly MatrixCommand<PackageCommand>[] = [
      {
        command: { type: "START_VALIDATION", expectedVersion: versionZero },
        at: beforeDeadline,
      },
      { command: { type: "MARK_READY", expectedVersion: versionZero }, at: beforeDeadline },
      {
        command: { type: "ACTIVATE", packageId, expectedVersion: versionZero },
        at: beforeDeadline,
      },
      { command: { type: "SUPERSEDE", expectedVersion: versionZero }, at: beforeDeadline },
      {
        command: { type: "FAIL", reason: "matrix", expectedVersion: versionZero },
        at: beforeDeadline,
      },
      { command: { type: "ABORT", expectedVersion: versionZero }, at: beforeDeadline },
    ];

    assertCartesianMatrix({
      scope: "package",
      states,
      commands,
      allowed: {
        UPLOADING: ["START_VALIDATION", "FAIL", "ABORT"],
        VALIDATING: ["MARK_READY", "FAIL", "ABORT"],
        READY: ["ACTIVATE", "FAIL", "ABORT"],
        ACTIVE: ["SUPERSEDE"],
        SUPERSEDED: [],
        FAILED: [],
        ABORTED: [],
      },
      createState: (status): PackageLifecycle => ({ status, version: versionZero }),
      transition: transitionPackageLifecycle,
    });
  });

  describe("death workflow", () => {
    const states: readonly DeathWorkflowState[] = [
      "AWAITING_CONFIRMATIONS",
      "GRACE_PERIOD",
      "RELEASE_PENDING",
      "RELEASED",
      "CANCELLED",
    ];
    const commands: readonly MatrixCommand<DeathCommand>[] = [
      {
        command: { type: "CONFIRM_DEATH", contactId: contactC, expectedVersion: versionZero },
        at: beforeDeadline,
      },
      { command: { type: "BEGIN_RELEASE", expectedVersion: versionZero }, at: invitationDeadline },
      { command: { type: "FINALIZE_RELEASE", expectedVersion: versionZero }, at: releaseDeadline },
      {
        command: { type: "CANCEL", reason: "matrix", expectedVersion: versionZero },
        at: beforeDeadline,
      },
      {
        command: {
          type: "CHANGE_THRESHOLD",
          requiredConfirmations: 3,
          expectedVersion: versionZero,
        },
        at: beforeDeadline,
      },
    ];

    assertCartesianMatrix({
      scope: "death workflow",
      states,
      commands,
      allowed: {
        AWAITING_CONFIRMATIONS: ["CONFIRM_DEATH", "CANCEL"],
        GRACE_PERIOD: ["BEGIN_RELEASE", "CANCEL"],
        RELEASE_PENDING: ["FINALIZE_RELEASE", "CANCEL"],
        RELEASED: [],
        CANCELLED: [],
      },
      createState: createDeathWorkflow,
      transition: transitionDeathWorkflow,
    });
  });

  describe("recovery workflow", () => {
    const states: readonly RecoveryWorkflowState[] = [
      "AWAITING_APPROVALS",
      "REWRAP_PENDING",
      "COMPLETED",
      "CANCELLED",
      "EXPIRED",
    ];
    const commands: readonly MatrixCommand<RecoveryCommand>[] = [
      {
        command: { type: "APPROVE", contactId: contactC, expectedVersion: versionZero },
        at: beforeDeadline,
      },
      { command: { type: "COMPLETE", expectedVersion: versionZero }, at: beforeDeadline },
      { command: { type: "CANCEL", expectedVersion: versionZero }, at: beforeDeadline },
      { command: { type: "EXPIRE", expectedVersion: versionZero }, at: recoveryDeadline },
      {
        command: {
          type: "CHANGE_THRESHOLD",
          requiredApprovals: 3,
          expectedVersion: versionZero,
        },
        at: beforeDeadline,
      },
    ];

    assertCartesianMatrix({
      scope: "recovery workflow",
      states,
      commands,
      allowed: {
        AWAITING_APPROVALS: ["APPROVE", "CANCEL", "EXPIRE"],
        REWRAP_PENDING: ["COMPLETE", "CANCEL", "EXPIRE"],
        COMPLETED: [],
        CANCELLED: [],
        EXPIRED: [],
      },
      createState: createRecoveryWorkflow,
      transition: transitionRecoveryWorkflow,
    });
  });

  describe("release workflow", () => {
    const states: readonly ReleaseWorkflowState[] = ["PENDING", "LOCKED", "RELEASED", "CANCELLED"];
    const commands: readonly MatrixCommand<ReleaseCommand>[] = [
      { command: { type: "LOCK", expectedVersion: versionZero }, at: releaseDeadline },
      { command: { type: "FINALIZE", expectedVersion: versionZero }, at: beforeDeadline },
      { command: { type: "CANCEL", expectedVersion: versionZero }, at: beforeDeadline },
    ];

    assertCartesianMatrix({
      scope: "release workflow",
      states,
      commands,
      allowed: {
        PENDING: ["LOCK", "CANCEL"],
        LOCKED: ["FINALIZE"],
        RELEASED: [],
        CANCELLED: [],
      },
      createState: (state): ReleaseWorkflow => ({
        state,
        version: versionZero,
        packageId,
        releaseAt: releaseDeadline,
      }),
      transition: transitionReleaseWorkflow,
    });
  });
});

function createDeathWorkflow(state: DeathWorkflowState): DeathWorkflow {
  const thresholdReached =
    state === "GRACE_PERIOD" || state === "RELEASE_PENDING" || state === "RELEASED";
  return {
    state,
    version: versionZero,
    contactIds: [contactA, contactB, contactC],
    requiredConfirmations: 2,
    approvedContactIds: thresholdReached ? [contactA, contactB] : [],
    approvedCount: thresholdReached ? 2 : 0,
    shareGenerationId,
    packageId,
    graceDeadline: invitationDeadline,
    releaseDelayDays: 1,
    ...(state === "RELEASE_PENDING" || state === "RELEASED" ? { releaseAt: releaseDeadline } : {}),
    ...(state === "RELEASED" || state === "CANCELLED" ? { endedAt: beforeDeadline } : {}),
    ...(state === "CANCELLED" ? { endReason: "matrix" } : {}),
  };
}

function createRecoveryWorkflow(state: RecoveryWorkflowState): RecoveryWorkflow {
  const thresholdReached = state === "REWRAP_PENDING" || state === "COMPLETED";
  return {
    state,
    version: versionZero,
    contactIds: [contactA, contactB, contactC],
    requiredApprovals: 2,
    approvedContactIds: thresholdReached ? [contactA, contactB] : [],
    approvedCount: thresholdReached ? 2 : 0,
    expiresAt: recoveryDeadline,
    shareGenerationId,
    ...(state === "COMPLETED" || state === "CANCELLED" || state === "EXPIRED"
      ? { endedAt: beforeDeadline }
      : {}),
  };
}
