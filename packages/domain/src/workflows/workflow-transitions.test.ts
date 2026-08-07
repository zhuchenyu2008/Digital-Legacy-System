import { describe, expect, test } from "vitest";
import {
  type ContactLifecycle,
  transitionContactLifecycle,
} from "../contacts/contact-lifecycle.js";
import { parseAggregateId } from "../shared/aggregate-id.js";
import { parseInstant } from "../shared/instant.js";
import { parseAggregateVersion } from "../shared/version.js";
import { type PackageLifecycle, transitionPackageLifecycle } from "../vault/package-lifecycle.js";
import {
  type ShareGenerationLifecycle,
  transitionShareGenerationLifecycle,
} from "../vault/share-generation-lifecycle.js";
import { type DeathWorkflow, transitionDeathWorkflow } from "./death-workflow.js";
import { type RecoveryWorkflow, transitionRecoveryWorkflow } from "./recovery-workflow.js";
import { type ReleaseWorkflow, transitionReleaseWorkflow } from "./release-workflow.js";
import { createWorkflowEvent } from "./workflow-events.js";

const at = parseInstant("2026-08-06T12:00:00Z");
const later = parseInstant("2026-08-06T12:00:01Z");
const contactA = parseAggregateId("01890a5d-ac96-7cc3-98c9-0bb31376f242");
const contactB = parseAggregateId("01890a5d-ac96-7cc3-98c9-0bb31376f243");
const contactC = parseAggregateId("01890a5d-ac96-7cc3-98c9-0bb31376f244");
const packageId = parseAggregateId("01890a5d-ac96-7cc3-98c9-0bb31376f245");
const shareGenerationId = parseAggregateId("01890a5d-ac96-7cc3-98c9-0bb31376f246");
const versionZero = parseAggregateVersion(0);

describe("contact lifecycle", () => {
  test("moves INVITED to CONSENTED to ACTIVE to REMOVED", () => {
    const invited: ContactLifecycle = {
      status: "INVITED",
      version: versionZero,
      invitationExpiresAt: parseInstant("2026-08-07T12:00:00Z"),
    };

    const consented = transitionContactLifecycle(
      invited,
      { type: "CONSENT", expectedVersion: invited.version },
      at,
    );
    expect(consented.state.status).toBe("CONSENTED");
    expect(consented.events.map((event) => event.type)).toEqual(["CONTACT_CONSENTED"]);

    const active = transitionContactLifecycle(
      consented.state,
      { type: "ACTIVATE", expectedVersion: consented.state.version },
      later,
    );
    expect(active.state.status).toBe("ACTIVE");
    expect(active.events.map((event) => event.type)).toEqual(["CONTACT_ACTIVATED"]);

    const removed = transitionContactLifecycle(
      active.state,
      { type: "REMOVE", expectedVersion: active.state.version },
      later,
    );
    expect(removed.state.status).toBe("REMOVED");
    expect(removed.events.map((event) => event.type)).toEqual(["CONTACT_REMOVED"]);
  });

  test("expires an invitation and rejects consent at or after its deadline", () => {
    const invited: ContactLifecycle = {
      status: "INVITED",
      version: versionZero,
      invitationExpiresAt: at,
    };

    const expired = transitionContactLifecycle(
      invited,
      { type: "EXPIRE_INVITATION", expectedVersion: invited.version },
      at,
    );
    expect(expired.state.status).toBe("REMOVED");
    expect(expired.events.map((event) => event.type)).toEqual(["CONTACT_INVITATION_EXPIRED"]);

    expect(() =>
      transitionContactLifecycle(
        invited,
        { type: "CONSENT", expectedVersion: invited.version },
        at,
      ),
    ).toThrow("invitation");
  });

  test("rejects expiry before the deadline and expiry commands after invitation state", () => {
    expect(() =>
      transitionContactLifecycle(
        { status: "INVITED", version: versionZero, invitationExpiresAt: later },
        { type: "EXPIRE_INVITATION", expectedVersion: versionZero },
        at,
      ),
    ).toThrow("deadline");
    expect(() =>
      transitionContactLifecycle(
        { status: "INVITED", version: versionZero },
        { type: "EXPIRE_INVITATION", expectedVersion: versionZero },
        at,
      ),
    ).toThrow("deadline");
    expect(() =>
      transitionContactLifecycle(
        { status: "ACTIVE", version: versionZero },
        { type: "EXPIRE_INVITATION", expectedVersion: versionZero },
        at,
      ),
    ).toThrow("transition");
  });

  test.each([
    { status: "INVITED", command: { type: "ACTIVATE" } },
    { status: "CONSENTED", command: { type: "CONSENT" } },
    { status: "ACTIVE", command: { type: "ACTIVATE" } },
    { status: "REMOVED", command: { type: "REMOVE" } },
  ] as const)("rejects invalid $status -> $command.type transition", ({ status, command }) => {
    const state: ContactLifecycle = {
      status,
      version: versionZero,
      invitationExpiresAt: parseInstant("2026-08-07T12:00:00Z"),
    };

    expect(() =>
      transitionContactLifecycle(state, { ...command, expectedVersion: state.version }, at),
    ).toThrow("transition");
  });
});

describe("share-generation lifecycle", () => {
  test("moves DRAFT to DISTRIBUTING to ACTIVE to SUPERSEDED", () => {
    const draft: ShareGenerationLifecycle = { status: "DRAFT", version: versionZero };
    const distributing = transitionShareGenerationLifecycle(
      draft,
      { type: "START_DISTRIBUTION", expectedVersion: draft.version },
      at,
    );
    expect(distributing.state.status).toBe("DISTRIBUTING");

    const active = transitionShareGenerationLifecycle(
      distributing.state,
      { type: "ACTIVATE", expectedVersion: distributing.state.version },
      later,
    );
    expect(active.state.status).toBe("ACTIVE");

    const superseded = transitionShareGenerationLifecycle(
      active.state,
      { type: "SUPERSEDE", expectedVersion: active.state.version },
      later,
    );
    expect(superseded.state.status).toBe("SUPERSEDED");
    expect(superseded.events.map((event) => event.type)).toEqual(["SHARE_GENERATION_SUPERSEDED"]);
  });

  test.each([
    { from: "DRAFT", command: { type: "ACTIVATE" } },
    { from: "ACTIVE", command: { type: "FAIL", reason: "late validation" } },
    { from: "SUPERSEDED", command: { type: "ACTIVATE" } },
    { from: "FAILED", command: { type: "START_DISTRIBUTION" } },
  ] as const)("rejects $from -> $command.type transition", ({ from, command }) => {
    const state: ShareGenerationLifecycle = { status: from, version: versionZero };

    expect(() =>
      transitionShareGenerationLifecycle(state, { ...command, expectedVersion: state.version }, at),
    ).toThrow("transition");
  });

  test("records a distribution failure before activation", () => {
    const distributing: ShareGenerationLifecycle = {
      status: "DISTRIBUTING",
      version: versionZero,
    };
    const failed = transitionShareGenerationLifecycle(
      distributing,
      { type: "FAIL", reason: "commitment mismatch", expectedVersion: distributing.version },
      at,
    );

    expect(failed.state).toMatchObject({ status: "FAILED", failureReason: "commitment mismatch" });
    expect(failed.events.map((event) => event.type)).toEqual(["SHARE_GENERATION_FAILED"]);
  });

  test.each([
    { from: "DRAFT", command: { type: "SUPERSEDE" } },
    { from: "DISTRIBUTING", command: { type: "SUPERSEDE" } },
    { from: "FAILED", command: { type: "FAIL", reason: "retry" } },
  ] as const)("rejects share transition $from -> $command.type", ({ from, command }) => {
    const state: ShareGenerationLifecycle = { status: from, version: versionZero };
    expect(() =>
      transitionShareGenerationLifecycle(state, { ...command, expectedVersion: state.version }, at),
    ).toThrow("transition");
  });
});

describe("package lifecycle", () => {
  test("moves UPLOADING to VALIDATING to READY to ACTIVE to SUPERSEDED", () => {
    const uploading: PackageLifecycle = { status: "UPLOADING", version: versionZero };
    const validating = transitionPackageLifecycle(
      uploading,
      { type: "START_VALIDATION", expectedVersion: uploading.version },
      at,
    );
    expect(validating.state.status).toBe("VALIDATING");

    const ready = transitionPackageLifecycle(
      validating.state,
      { type: "MARK_READY", expectedVersion: validating.state.version },
      later,
    );
    expect(ready.state.status).toBe("READY");

    const active = transitionPackageLifecycle(
      ready.state,
      { type: "ACTIVATE", packageId, expectedVersion: ready.state.version },
      later,
    );
    expect(active.state).toMatchObject({ status: "ACTIVE", packageId });

    const superseded = transitionPackageLifecycle(
      active.state,
      { type: "SUPERSEDE", expectedVersion: active.state.version },
      later,
    );
    expect(superseded.state.status).toBe("SUPERSEDED");
  });

  test.each([
    { from: "UPLOADING", command: { type: "MARK_READY" } },
    { from: "VALIDATING", command: { type: "SUPERSEDE" } },
    { from: "ACTIVE", command: { type: "ABORT" } },
    { from: "SUPERSEDED", command: { type: "ACTIVATE", packageId } },
  ] as const)("rejects invalid $from -> $command.type transition", ({ from, command }) => {
    const state: PackageLifecycle = { status: from, version: versionZero };

    expect(() =>
      transitionPackageLifecycle(state, { ...command, expectedVersion: state.version }, at),
    ).toThrow("transition");
  });

  test("allows failure and abort only before activation", () => {
    const validating: PackageLifecycle = { status: "VALIDATING", version: versionZero };
    const failed = transitionPackageLifecycle(
      validating,
      { type: "FAIL", reason: "checksum mismatch", expectedVersion: validating.version },
      at,
    );
    expect(failed.state).toMatchObject({ status: "FAILED", failureReason: "checksum mismatch" });

    const ready: PackageLifecycle = { status: "READY", version: versionZero };
    const aborted = transitionPackageLifecycle(
      ready,
      { type: "ABORT", expectedVersion: ready.version },
      at,
    );
    expect(aborted.state.status).toBe("ABORTED");
  });

  test.each([
    { from: "ACTIVE", command: { type: "FAIL", reason: "late" } },
    { from: "SUPERSEDED", command: { type: "FAIL", reason: "late" } },
    { from: "FAILED", command: { type: "ABORT" } },
    { from: "ABORTED", command: { type: "FAIL", reason: "retry" } },
  ] as const)("rejects package transition $from -> $command.type", ({ from, command }) => {
    const state: PackageLifecycle = { status: from, version: versionZero };
    expect(() =>
      transitionPackageLifecycle(state, { ...command, expectedVersion: state.version }, at),
    ).toThrow("transition");
  });
});

describe("death workflow", () => {
  test("requires unique snapshot contacts and enters grace after the threshold", () => {
    const workflow = createDeathWorkflow();
    const first = transitionDeathWorkflow(
      workflow,
      { type: "CONFIRM_DEATH", contactId: contactA, expectedVersion: workflow.version },
      at,
    );
    expect(first.state).toMatchObject({ state: "AWAITING_CONFIRMATIONS", approvedCount: 1 });

    expect(() =>
      transitionDeathWorkflow(
        first.state,
        { type: "CONFIRM_DEATH", contactId: contactA, expectedVersion: first.state.version },
        later,
      ),
    ).toThrow("already acted");

    const second = transitionDeathWorkflow(
      first.state,
      { type: "CONFIRM_DEATH", contactId: contactB, expectedVersion: first.state.version },
      later,
    );
    expect(second.state).toMatchObject({ state: "GRACE_PERIOD", approvedCount: 2 });
    expect(second.state.contactIds).toEqual([contactA, contactB, contactC]);
    expect(second.events.map((event) => event.type)).toEqual([
      "DEATH_CONFIRMATION_RECORDED",
      "DEATH_GRACE_STARTED",
    ]);

    expect(() =>
      transitionDeathWorkflow(
        second.state,
        { type: "CONFIRM_DEATH", contactId: contactA, expectedVersion: second.state.version },
        later,
      ),
    ).toThrow("transition");
    expect(() =>
      transitionDeathWorkflow(
        workflow,
        {
          type: "CONFIRM_DEATH",
          contactId: parseAggregateId("01890a5d-ac96-7cc3-98c9-0bb31376f247"),
          expectedVersion: workflow.version,
        },
        at,
      ),
    ).toThrow("snapshot");
    expect(() =>
      transitionDeathWorkflow(
        workflow,
        {
          type: "CHANGE_THRESHOLD",
          requiredConfirmations: 3,
          expectedVersion: workflow.version,
        },
        at,
      ),
    ).toThrow("snapshot");
    expect(() =>
      transitionDeathWorkflow(
        workflow,
        { type: "CONFIRM_DEATH", contactId: contactA, expectedVersion: parseAggregateVersion(1) },
        at,
      ),
    ).toThrow("version");
  });

  test("returns a new deeply immutable workflow snapshot and immutable events", () => {
    const workflow = createDeathWorkflow();
    const transitioned = transitionDeathWorkflow(
      workflow,
      { type: "CONFIRM_DEATH", contactId: contactA, expectedVersion: workflow.version },
      at,
    );

    expect(transitioned.state).not.toBe(workflow);
    expect(workflow.approvedContactIds).toEqual([]);
    expect(Object.isFrozen(transitioned.state)).toBe(true);
    expect(Object.isFrozen(transitioned.state.contactIds)).toBe(true);
    expect(Object.isFrozen(transitioned.state.approvedContactIds)).toBe(true);
    expect(Object.isFrozen(transitioned.events)).toBe(true);
    expect(Object.isFrozen(transitioned.events[0])).toBe(true);
  });

  test("moves grace to release pending and releases on exact deadline", () => {
    const workflow = createDeathWorkflow();
    const first = transitionDeathWorkflow(
      workflow,
      { type: "CONFIRM_DEATH", contactId: contactA, expectedVersion: workflow.version },
      at,
    );
    const grace = transitionDeathWorkflow(
      first.state,
      { type: "CONFIRM_DEATH", contactId: contactB, expectedVersion: first.state.version },
      later,
    ).state;
    const pending = transitionDeathWorkflow(
      grace,
      { type: "BEGIN_RELEASE", expectedVersion: grace.version },
      parseInstant("2026-08-07T12:00:00Z"),
    );
    expect(pending.state).toMatchObject({
      state: "RELEASE_PENDING",
      releaseAt: "2026-08-08T12:00:00Z",
    });

    const released = transitionDeathWorkflow(
      pending.state,
      { type: "FINALIZE_RELEASE", expectedVersion: pending.state.version },
      parseInstant("2026-08-08T12:00:00Z"),
    );
    expect(released.state.state).toBe("RELEASED");
  });

  test("rejects release advancement from wrong states, before deadlines, or without metadata", () => {
    const workflow = createDeathWorkflow();
    expect(() =>
      transitionDeathWorkflow(
        workflow,
        { type: "BEGIN_RELEASE", expectedVersion: workflow.version },
        at,
      ),
    ).toThrow("transition");

    const grace = createDeathWorkflow({ state: "GRACE_PERIOD" });
    expect(() =>
      transitionDeathWorkflow(grace, { type: "BEGIN_RELEASE", expectedVersion: grace.version }, at),
    ).toThrow("deadline");

    const pending = createDeathWorkflow({
      state: "RELEASE_PENDING",
      releaseAt: parseInstant("2026-08-07T12:00:00Z"),
    });
    expect(() =>
      transitionDeathWorkflow(
        pending,
        { type: "FINALIZE_RELEASE", expectedVersion: pending.version },
        at,
      ),
    ).toThrow("deadline");
    expect(() =>
      transitionDeathWorkflow(
        { ...pending, releaseAt: undefined },
        { type: "FINALIZE_RELEASE", expectedVersion: pending.version },
        at,
      ),
    ).toThrow("snapshot");
  });

  test.each(["AWAITING_CONFIRMATIONS", "GRACE_PERIOD", "RELEASE_PENDING"] as const)(
    "allows cancellation from pre-release state %s before release is locked",
    (stateName) => {
      const workflow = createDeathWorkflow({ state: stateName });
      const cancellable =
        stateName === "RELEASE_PENDING"
          ? { ...workflow, releaseAt: parseInstant("2026-08-07T12:00:00Z") }
          : workflow;
      const cancelled = transitionDeathWorkflow(
        cancellable,
        { type: "CANCEL", reason: "owner alive", expectedVersion: cancellable.version },
        at,
      );

      expect(cancelled.state).toMatchObject({ state: "CANCELLED", endReason: "owner alive" });
    },
  );

  test("rejects cancellation at the release deadline and all terminal transitions", () => {
    const pending = createDeathWorkflow({
      state: "RELEASE_PENDING",
      releaseAt: parseInstant("2026-08-06T12:00:00Z"),
    });

    expect(() =>
      transitionDeathWorkflow(
        pending,
        { type: "CANCEL", reason: "too late", expectedVersion: pending.version },
        at,
      ),
    ).toThrow("deadline");
    expect(() =>
      transitionDeathWorkflow(
        { ...pending, state: "RELEASED", endedAt: at },
        { type: "CANCEL", reason: "late", expectedVersion: pending.version },
        at,
      ),
    ).toThrow("transition");
  });

  test("rejects malformed death snapshots before evaluating a command", () => {
    const workflow = createDeathWorkflow();
    expect(() =>
      transitionDeathWorkflow(
        { ...workflow, contactIds: [contactA, contactA, contactC] },
        { type: "CANCEL", reason: "invalid", expectedVersion: workflow.version },
        at,
      ),
    ).toThrow("snapshot");
    expect(() =>
      transitionDeathWorkflow(
        { ...workflow, approvedContactIds: [contactA], approvedCount: 0 },
        { type: "CANCEL", reason: "invalid", expectedVersion: workflow.version },
        at,
      ),
    ).toThrow("snapshot");
    expect(() =>
      transitionDeathWorkflow(
        { ...workflow, approvedContactIds: [contactA, contactA], approvedCount: 2 },
        { type: "CANCEL", reason: "invalid", expectedVersion: workflow.version },
        at,
      ),
    ).toThrow("snapshot");
    expect(() =>
      transitionDeathWorkflow(
        { ...workflow, state: "GRACE_PERIOD" },
        { type: "BEGIN_RELEASE", expectedVersion: workflow.version },
        workflow.graceDeadline,
      ),
    ).toThrow("snapshot");
    expect(() =>
      transitionDeathWorkflow(
        { ...workflow, state: "RELEASE_PENDING" },
        { type: "CANCEL", reason: "invalid", expectedVersion: workflow.version },
        at,
      ),
    ).toThrow("snapshot");
  });
});

describe("recovery workflow", () => {
  test("enters rewrap pending exactly when the approval threshold is reached", () => {
    const workflow = createRecoveryWorkflow();
    const first = transitionRecoveryWorkflow(
      workflow,
      { type: "APPROVE", contactId: contactA, expectedVersion: workflow.version },
      at,
    );
    expect(first.state).toMatchObject({ state: "AWAITING_APPROVALS", approvedCount: 1 });

    expect(() =>
      transitionRecoveryWorkflow(
        first.state,
        { type: "APPROVE", contactId: contactA, expectedVersion: first.state.version },
        later,
      ),
    ).toThrow("already acted");

    const second = transitionRecoveryWorkflow(
      first.state,
      { type: "APPROVE", contactId: contactB, expectedVersion: first.state.version },
      later,
    );
    expect(second.state).toMatchObject({ state: "REWRAP_PENDING", approvedCount: 2 });
    expect(second.events.map((event) => event.type)).toEqual([
      "RECOVERY_APPROVAL_RECORDED",
      "RECOVERY_REWRAP_PENDING",
    ]);

    const completed = transitionRecoveryWorkflow(
      second.state,
      { type: "COMPLETE", expectedVersion: second.state.version },
      later,
    );
    expect(completed.state.state).toBe("COMPLETED");
  });

  test("expires at the exact deadline and rejects duplicate or outsider approvals", () => {
    const workflow = createRecoveryWorkflow();
    expect(() =>
      transitionRecoveryWorkflow(
        workflow,
        { type: "APPROVE", contactId: contactA, expectedVersion: workflow.version },
        at,
      ),
    ).not.toThrow();
    expect(() =>
      transitionRecoveryWorkflow(
        workflow,
        {
          type: "APPROVE",
          contactId: parseAggregateId("01890a5d-ac96-7cc3-98c9-0bb31376f247"),
          expectedVersion: workflow.version,
        },
        at,
      ),
    ).toThrow("snapshot");

    const expired = transitionRecoveryWorkflow(
      workflow,
      { type: "EXPIRE", expectedVersion: workflow.version },
      parseInstant("2026-08-13T12:00:00Z"),
    );
    expect(expired.state.state).toBe("EXPIRED");
  });

  test("rejects recovery expiry before the deadline and commands after terminal states", () => {
    const workflow = createRecoveryWorkflow();
    expect(() =>
      transitionRecoveryWorkflow(
        workflow,
        { type: "EXPIRE", expectedVersion: workflow.version },
        at,
      ),
    ).toThrow("deadline");
    expect(() =>
      transitionRecoveryWorkflow(
        createRecoveryWorkflow({ state: "COMPLETED" }),
        { type: "EXPIRE", expectedVersion: workflow.version },
        at,
      ),
    ).toThrow("transition");
    expect(() =>
      transitionRecoveryWorkflow(
        createRecoveryWorkflow({ state: "COMPLETED" }),
        { type: "CANCEL", expectedVersion: workflow.version },
        at,
      ),
    ).toThrow("transition");
    expect(() =>
      transitionRecoveryWorkflow(
        workflow,
        { type: "CHANGE_THRESHOLD", requiredApprovals: 3, expectedVersion: workflow.version },
        at,
      ),
    ).toThrow("snapshot");
  });

  test("rejects approvals after threshold state, approvals at expiry, and premature completion", () => {
    const workflow = createRecoveryWorkflow();
    expect(() =>
      transitionRecoveryWorkflow(
        createRecoveryWorkflow({ state: "REWRAP_PENDING" }),
        { type: "APPROVE", contactId: contactA, expectedVersion: workflow.version },
        at,
      ),
    ).toThrow("transition");
    expect(() =>
      transitionRecoveryWorkflow(
        workflow,
        { type: "APPROVE", contactId: contactA, expectedVersion: workflow.version },
        workflow.expiresAt,
      ),
    ).toThrow("deadline");
    expect(() =>
      transitionRecoveryWorkflow(
        workflow,
        { type: "COMPLETE", expectedVersion: workflow.version },
        at,
      ),
    ).toThrow("transition");
  });

  test("rejects completion and cancellation at or after the recovery deadline", () => {
    const workflow = createRecoveryWorkflow({
      state: "REWRAP_PENDING",
      approvedContactIds: [contactA, contactB],
      approvedCount: 2,
    });

    expect(() =>
      transitionRecoveryWorkflow(
        workflow,
        { type: "COMPLETE", expectedVersion: workflow.version },
        workflow.expiresAt,
      ),
    ).toThrow("deadline");
    expect(() =>
      transitionRecoveryWorkflow(
        workflow,
        { type: "CANCEL", expectedVersion: workflow.version },
        parseInstant("2026-08-13T12:00:00.001Z"),
      ),
    ).toThrow("deadline");
  });

  test("rejects malformed recovery snapshots", () => {
    const workflow = createRecoveryWorkflow();
    expect(() =>
      transitionRecoveryWorkflow(
        { ...workflow, contactIds: [contactA, contactA, contactC] },
        { type: "CANCEL", expectedVersion: workflow.version },
        at,
      ),
    ).toThrow("snapshot");
    expect(() =>
      transitionRecoveryWorkflow(
        { ...workflow, approvedContactIds: [contactA, contactA], approvedCount: 2 },
        { type: "CANCEL", expectedVersion: workflow.version },
        at,
      ),
    ).toThrow("snapshot");
    expect(() =>
      transitionRecoveryWorkflow(
        { ...workflow, state: "REWRAP_PENDING" },
        { type: "COMPLETE", expectedVersion: workflow.version },
        at,
      ),
    ).toThrow("snapshot");
  });

  test.each(["AWAITING_APPROVALS", "REWRAP_PENDING"] as const)(
    "allows cancellation from %s",
    (stateName) => {
      const workflow = createRecoveryWorkflow({ state: stateName });
      const cancelled = transitionRecoveryWorkflow(
        workflow,
        { type: "CANCEL", expectedVersion: workflow.version },
        at,
      );

      expect(cancelled.state.state).toBe("CANCELLED");
    },
  );
});

describe("release workflow", () => {
  test("locks at the exact release deadline and then finalizes", () => {
    const workflow: ReleaseWorkflow = {
      state: "PENDING",
      packageId,
      releaseAt: parseInstant("2026-08-06T12:00:00Z"),
      version: versionZero,
    };
    const locked = transitionReleaseWorkflow(
      workflow,
      { type: "LOCK", expectedVersion: workflow.version },
      at,
    );
    expect(locked.state.state).toBe("LOCKED");

    const released = transitionReleaseWorkflow(
      locked.state,
      { type: "FINALIZE", expectedVersion: locked.state.version },
      later,
    );
    expect(released.state.state).toBe("RELEASED");
  });

  test("allows cancellation before the release deadline but never after locking", () => {
    const workflow: ReleaseWorkflow = {
      state: "PENDING",
      packageId,
      releaseAt: parseInstant("2026-08-07T12:00:00Z"),
      version: versionZero,
    };
    const cancelled = transitionReleaseWorkflow(
      workflow,
      { type: "CANCEL", expectedVersion: workflow.version },
      at,
    );
    expect(cancelled.state.state).toBe("CANCELLED");

    expect(() =>
      transitionReleaseWorkflow(
        { ...workflow, state: "LOCKED" },
        { type: "CANCEL", expectedVersion: workflow.version },
        at,
      ),
    ).toThrow("transition");
  });

  test("rejects locking before the deadline, cancellation at the deadline, and finalizing pending", () => {
    const workflow: ReleaseWorkflow = {
      state: "PENDING",
      packageId,
      releaseAt: parseInstant("2026-08-07T12:00:00Z"),
      version: versionZero,
    };
    expect(() =>
      transitionReleaseWorkflow(workflow, { type: "LOCK", expectedVersion: workflow.version }, at),
    ).toThrow("deadline");
    expect(() =>
      transitionReleaseWorkflow(
        { ...workflow, releaseAt: at },
        { type: "CANCEL", expectedVersion: workflow.version },
        at,
      ),
    ).toThrow("deadline");
    expect(() =>
      transitionReleaseWorkflow(
        workflow,
        { type: "FINALIZE", expectedVersion: workflow.version },
        at,
      ),
    ).toThrow("transition");
    expect(() =>
      transitionReleaseWorkflow(
        { ...workflow, state: "LOCKED" },
        { type: "LOCK", expectedVersion: workflow.version },
        workflow.releaseAt,
      ),
    ).toThrow("transition");
  });

  test("copies and freezes an optional workflow event payload", () => {
    const payload = { packageVersion: 3 };
    const event = createWorkflowEvent("DEATH_RELEASED", at, versionZero, payload);

    payload.packageVersion = 4;

    expect(event).toEqual({
      type: "DEATH_RELEASED",
      occurredAt: at,
      aggregateVersion: versionZero,
      payload: { packageVersion: 3 },
    });
    expect(Object.isFrozen(event.payload)).toBe(true);
    expect(() => Object.assign(event.payload ?? {}, { packageVersion: 5 })).toThrow(TypeError);
  });

  test("supports a payload without an aggregate version", () => {
    expect(createWorkflowEvent("DEATH_RELEASED", at, undefined, { packageVersion: 3 })).toEqual({
      type: "DEATH_RELEASED",
      occurredAt: at,
      payload: { packageVersion: 3 },
    });
  });
});

function createDeathWorkflow(overrides: Partial<DeathWorkflow> = {}): DeathWorkflow {
  const state = overrides.state ?? "AWAITING_CONFIRMATIONS";
  const thresholdReached =
    state === "GRACE_PERIOD" || state === "RELEASE_PENDING" || state === "RELEASED";
  const terminal = state === "RELEASED" || state === "CANCELLED";
  return {
    state,
    contactIds: [contactA, contactB, contactC],
    requiredConfirmations: 2,
    approvedContactIds: thresholdReached ? [contactA, contactB] : [],
    approvedCount: thresholdReached ? 2 : 0,
    shareGenerationId,
    packageId,
    graceDeadline: parseInstant("2026-08-07T12:00:00Z"),
    releaseDelayDays: 1,
    version: versionZero,
    ...(state === "RELEASE_PENDING" || state === "RELEASED"
      ? { releaseAt: parseInstant("2026-08-08T12:00:00Z") }
      : {}),
    ...(terminal ? { endedAt: at } : {}),
    ...(state === "CANCELLED" ? { endReason: "cancelled" } : {}),
    ...overrides,
  };
}

function createRecoveryWorkflow(overrides: Partial<RecoveryWorkflow> = {}): RecoveryWorkflow {
  const state = overrides.state ?? "AWAITING_APPROVALS";
  const thresholdReached = state === "REWRAP_PENDING" || state === "COMPLETED";
  const terminal = state === "COMPLETED" || state === "CANCELLED" || state === "EXPIRED";
  return {
    state,
    contactIds: [contactA, contactB, contactC],
    requiredApprovals: 2,
    approvedContactIds: thresholdReached ? [contactA, contactB] : [],
    approvedCount: thresholdReached ? 2 : 0,
    expiresAt: parseInstant("2026-08-13T12:00:00Z"),
    shareGenerationId,
    version: versionZero,
    ...(terminal ? { endedAt: at } : {}),
    ...overrides,
  };
}
