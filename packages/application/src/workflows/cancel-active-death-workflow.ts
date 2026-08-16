import type { TransactionContext } from "../ports/transaction-manager.js";
import { destroyWorkflowFragments, workflowRepository } from "./contact-decision-common.js";

const TERMINAL_STATES = new Set(["COMPLETED", "CANCELLED", "EXPIRED", "RELEASED"]);

export type ActiveDeathCancellation = Readonly<{
  cancelled: boolean;
  previousState: string | null;
}>;

/**
 * A successful owner authentication is an explicit liveness signal. It must
 * cancel every active, not-yet-locked death workflow in the same transaction
 * as the check-in, so a queued worker cannot continue the old release path.
 */
export async function cancelActiveDeathWorkflow(
  tx: TransactionContext,
  now: string,
  reason: "OWNER_AUTHENTICATED" | "OWNER_EXPLICIT_CHECKIN",
  idFactory: () => string = () => crypto.randomUUID(),
): Promise<ActiveDeathCancellation> {
  const rows =
    (await tx.repositories.workflows.findMany?.(undefined, undefined, {
      forUpdate: true,
    })) ?? [];
  const workflow = rows.find(
    (row) =>
      row.kind === "DEATH_CONFIRMATION" &&
      !TERMINAL_STATES.has(String(row.state)) &&
      (row.publish_locked_at === null || row.publish_locked_at === undefined),
  );
  if (workflow === undefined) return { cancelled: false, previousState: null };

  const previousState = String(workflow.state);
  await destroyWorkflowFragments(tx, String(workflow.id));
  const sessions = workflowRepository(tx.repositories.releaseSecretSessions, "release sessions");
  const releaseSession = await sessions.findOneBy?.("workflow_id", workflow.id, {
    forUpdate: true,
  });
  if (
    releaseSession !== null &&
    releaseSession !== undefined &&
    releaseSession.status !== "DESTROYED"
  ) {
    await sessions.updateVersioned(releaseSession.id, Number(releaseSession.version ?? 0), {
      status: "DESTROYED",
      stage_key_envelope: null,
      stage_key_nonce: null,
      consumed_at: now,
    });
  }
  const tokens = tx.repositories.oneTimeTokens;
  for (const token of (await tokens?.findMany?.("subject_id", workflow.id, { forUpdate: true })) ??
    []) {
    if (
      token.consumed_at === null &&
      token.revoked_at === null &&
      tokens?.updateById !== undefined
    ) {
      await tokens.updateById(token.id, { revoked_at: now });
    }
  }

  const updated = await tx.repositories.workflows.updateVersioned(
    workflow.id,
    Number(workflow.version ?? 0),
    {
      state: "CANCELLED",
      ended_at: now,
      end_reason: reason,
    },
  );
  await tx.outbox.enqueue({
    eventType: "DEATH_CANCELLED_BY_OWNER",
    aggregateType: "workflow",
    aggregateId: String(workflow.id),
    payload: {
      aggregateId: String(workflow.id),
      aggregateVersion: Number(updated.version ?? Number(workflow.version ?? 0) + 1),
    },
    idempotencyKey: `death-cancelled-by-owner:${String(workflow.id)}:${reason}`,
    availableAt: now,
  });
  await tx.audit.append({
    eventId: idFactory(),
    occurredAt: now,
    eventType: "DEATH_WORKFLOW_CANCELLED_BY_OWNER",
    actorType: "OWNER",
    aggregateType: "workflow",
    aggregateId: String(workflow.id),
    result: "SUCCESS",
    metadata: { previousState, reason },
  });
  return { cancelled: true, previousState };
}
