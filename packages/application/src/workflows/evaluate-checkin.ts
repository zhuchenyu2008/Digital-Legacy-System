import { parseInstant } from "@dls/domain";
import type { TransactionManager } from "../ports/transaction-manager.js";
import {
  type DeathWorkflowStartResult,
  type StartDeathWorkflowCommand,
  startDeathWorkflowInTransaction,
  WorkflowError,
} from "./start-death-workflow.js";

export type EvaluateCheckinResult =
  | DeathWorkflowStartResult
  | Readonly<{ status: "NOT_DUE"; deadlineAt: string }>;

export async function evaluateCheckin(
  command: StartDeathWorkflowCommand,
  dependencies: Readonly<{ transaction: TransactionManager; idFactory?: () => string }>,
): Promise<EvaluateCheckinResult> {
  if (!Number.isSafeInteger(command.scheduleVersion) || command.scheduleVersion < 1) {
    throw new WorkflowError("DLS-WORKFLOW-SNAPSHOT-INVALID", "schedule version is invalid", 422);
  }
  const idFactory = dependencies.idFactory ?? (() => crypto.randomUUID());
  return dependencies.transaction.run(async (tx) => {
    const schedule = await tx.repositories.checkinSchedules.findById(command.scheduleId, {
      forUpdate: true,
    });
    if (schedule === null || Number(schedule.schedule_version) !== command.scheduleVersion) {
      return { status: "STALE" };
    }
    const currentWorkflows =
      (await tx.repositories.workflows.findMany?.(undefined, undefined, { forUpdate: true })) ?? [];
    const activeDeath = currentWorkflows.find(
      (row) =>
        row.kind === "DEATH_CONFIRMATION" &&
        !["COMPLETED", "CANCELLED", "EXPIRED", "RELEASED"].includes(String(row.state)),
    );
    if (activeDeath !== undefined) {
      return { status: "ALREADY_STARTED", workflowId: String(activeDeath.id) };
    }
    if (schedule.status !== "ACTIVE") return { status: "STALE" };
    const now = await tx.clock.now();
    const deadlineAt = parseInstant(String(schedule.deadline_at));
    if (Date.parse(now) < Date.parse(deadlineAt)) {
      await tx.outbox.enqueue({
        eventType: "CHECKIN_EVALUATE_REQUESTED",
        aggregateType: "checkin_schedule",
        aggregateId: command.scheduleId,
        payload: {
          aggregateId: command.scheduleId,
          aggregateVersion: command.scheduleVersion,
        },
        idempotencyKey: `checkin-evaluate:${command.scheduleId}:${command.scheduleVersion}`,
        availableAt: deadlineAt,
      });
      return { status: "NOT_DUE", deadlineAt };
    }
    const result = await startDeathWorkflowInTransaction(command, {
      tx,
      now,
      currentWorkflows,
      idFactory,
    });
    if (result.status === "STARTED") {
      await tx.repositories.checkinSchedules.updateVersioned(
        schedule.id,
        Number(schedule.version ?? 0),
        { status: "TRIGGERED" },
      );
    }
    return result;
  });
}
