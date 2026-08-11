import type { TransactionManager } from "../ports/transaction-manager.js";
import { destroyRecoveryArtifacts } from "./recovery-common.js";

export type ExpireRecoveryResult = Readonly<{
  status: "EXPIRED" | "WAITING" | "STALE" | "CLOSED";
}>;

export async function expireRecovery(
  command: Readonly<{ workflowId: string; aggregateVersion: number }>,
  dependencies: Readonly<{ transaction: TransactionManager }>,
): Promise<ExpireRecoveryResult> {
  return dependencies.transaction.run(async (tx) => {
    const workflow = await tx.repositories.workflows.findById(command.workflowId, {
      forUpdate: true,
    });
    if (workflow === null || workflow.kind !== "PASSWORD_RECOVERY") return { status: "STALE" };
    if (["COMPLETED", "CANCELLED", "EXPIRED"].includes(String(workflow.state))) {
      return { status: "CLOSED" };
    }
    const currentVersion = Number(workflow.version ?? 0);
    if (command.aggregateVersion > currentVersion) return { status: "STALE" };
    const now = await tx.clock.now();
    if (
      typeof workflow.expires_at !== "string" ||
      Date.parse(now) < Date.parse(workflow.expires_at)
    ) {
      return { status: "WAITING" };
    }
    await destroyRecoveryArtifacts(tx, command.workflowId, now);
    await tx.repositories.workflows.updateVersioned(command.workflowId, currentVersion, {
      state: "EXPIRED",
      ended_at: now,
      end_reason: "RECOVERY_WINDOW_EXPIRED",
    });
    await tx.audit.append({
      eventId: crypto.randomUUID(),
      occurredAt: now,
      eventType: "PASSWORD_RECOVERY_EXPIRED",
      actorType: "SYSTEM",
      aggregateType: "workflow",
      aggregateId: command.workflowId,
      result: "SUCCESS",
      metadata: {},
    });
    return { status: "EXPIRED" };
  });
}
