import { parseInstant } from "@dls/domain";
import type { OwnerServerPasswordVerifier } from "../owner/login-owner.js";
import type { TransactionContext, TransactionManager } from "../ports/transaction-manager.js";
import { sha256, workflowRepository } from "./contact-decision-common.js";
import { WorkflowError } from "./start-death-workflow.js";

export type CancelDeathWorkflowCommand = Readonly<{
  workflowId: string;
  ownerId: string;
  password: string;
  requestId: string;
}>;

export type CancelDeathWorkflowResult = Readonly<{
  cancelled: true;
  workflowState: "CANCELLED";
  endedAt: string;
}>;

async function reserveCancellation(
  tx: TransactionContext,
  command: CancelDeathWorkflowCommand,
): Promise<Readonly<{ id: string; replay?: CancelDeathWorkflowResult }>> {
  const reservation = await tx.repositories.idempotency.reserve({
    actorScope: `OWNER:${command.ownerId}`,
    commandName: "CANCEL_DEATH_WORKFLOW",
    keyDigest: sha256(command.requestId),
    requestHash: sha256(JSON.stringify({ workflowId: command.workflowId })),
  });
  return reservation.status === "COMPLETED"
    ? { id: reservation.id, replay: reservation.responseBody as CancelDeathWorkflowResult }
    : { id: reservation.id };
}

function releaseLocked(): never {
  throw new WorkflowError(
    "DLS-RELEASE-LOCKED",
    "the publication deadline is locked and can no longer be cancelled",
    409,
  );
}

async function destroyReleaseSecrets(
  tx: TransactionContext,
  workflowId: string,
  now: string,
): Promise<void> {
  const sessions = workflowRepository(tx.repositories.releaseSecretSessions, "release sessions");
  const session = await sessions.findOneBy?.("workflow_id", workflowId, { forUpdate: true });
  if (session !== null && session !== undefined && session.status !== "DESTROYED") {
    await sessions.updateVersioned(session.id, Number(session.version ?? 0), {
      status: "DESTROYED",
      stage_key_envelope: null,
      stage_key_nonce: null,
      consumed_at: now,
    });
  }

  const tokens = tx.repositories.oneTimeTokens;
  const rows = (await tokens?.findMany?.("subject_id", workflowId, { forUpdate: true })) ?? [];
  for (const token of rows) {
    if (
      token.consumed_at === null &&
      token.revoked_at === null &&
      tokens?.updateById !== undefined
    ) {
      await tokens.updateById(token.id, { revoked_at: now });
    }
  }
}

export async function cancelDeathWorkflow(
  command: CancelDeathWorkflowCommand,
  dependencies: Readonly<{
    transaction: TransactionManager;
    passwordVerifier: OwnerServerPasswordVerifier;
    idFactory?: () => string;
  }>,
): Promise<CancelDeathWorkflowResult> {
  return dependencies.transaction.run(async (tx) => {
    const reservation = await reserveCancellation(tx, command);
    if (reservation.replay !== undefined) return reservation.replay;

    const credentials = await tx.repositories.ownerCredentials.findById(true, {
      forUpdate: true,
    });
    if (
      credentials === null ||
      typeof credentials.password_phc !== "string" ||
      typeof command.password !== "string" ||
      command.password.length === 0 ||
      !(await dependencies.passwordVerifier(command.password, credentials.password_phc))
    ) {
      throw new WorkflowError(
        "DLS-OWNER-REAUTH-REQUIRED",
        "current master password reauthentication is required",
        401,
      );
    }

    const workflow = await tx.repositories.workflows.findById(command.workflowId, {
      forUpdate: true,
    });
    if (workflow === null || workflow.kind !== "DEATH_CONFIRMATION") {
      throw new WorkflowError("DLS-WORKFLOW-NOT-FOUND", "workflow was not found", 404);
    }
    if (workflow.publish_locked_at !== null && workflow.publish_locked_at !== undefined) {
      releaseLocked();
    }
    if (workflow.state === "CANCELLED" && workflow.end_reason === "OWNER_CONFIRMED_ALIVE") {
      if (typeof workflow.ended_at !== "string") {
        throw new WorkflowError("DLS-WORKFLOW-INVALID", "cancelled workflow is invalid", 500);
      }
      const response: CancelDeathWorkflowResult = {
        cancelled: true,
        workflowState: "CANCELLED",
        endedAt: parseInstant(workflow.ended_at),
      };
      await tx.repositories.idempotency.complete(reservation.id, 200, response);
      return response;
    }
    if (workflow.state !== "RELEASE_PENDING") {
      throw new WorkflowError(
        "DLS-WORKFLOW-CLOSED",
        "workflow is not eligible for owner cancellation",
        409,
      );
    }

    const now = await tx.clock.now();
    if (
      typeof workflow.release_at !== "string" ||
      Date.parse(now) >= Date.parse(workflow.release_at)
    ) {
      releaseLocked();
    }
    const nextVersion = Number(workflow.version ?? 0) + 1;
    await tx.repositories.workflows.updateVersioned(
      command.workflowId,
      Number(workflow.version ?? 0),
      {
        state: "CANCELLED",
        ended_at: now,
        end_reason: "OWNER_CONFIRMED_ALIVE",
      },
    );
    await destroyReleaseSecrets(tx, command.workflowId, now);
    await tx.outbox.enqueue({
      eventType: "DEATH_WORKFLOW_CANCELLED",
      aggregateType: "workflow",
      aggregateId: command.workflowId,
      payload: { aggregateId: command.workflowId, aggregateVersion: nextVersion },
      idempotencyKey: `owner-cancel:${command.workflowId}:${nextVersion}`,
      availableAt: now,
    });
    await tx.audit.append({
      eventId: dependencies.idFactory?.() ?? crypto.randomUUID(),
      occurredAt: now,
      eventType: "DEATH_WORKFLOW_CANCELLED",
      actorType: "OWNER",
      aggregateType: "workflow",
      aggregateId: command.workflowId,
      requestId: command.requestId,
      result: "SUCCESS",
      metadata: { reason: "OWNER_CONFIRMED_ALIVE" },
    });
    const response: CancelDeathWorkflowResult = {
      cancelled: true,
      workflowState: "CANCELLED",
      endedAt: parseInstant(now),
    };
    await tx.repositories.idempotency.complete(reservation.id, 200, response);
    return response;
  });
}
