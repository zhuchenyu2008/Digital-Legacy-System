import type { RepositoryRow, VersionedRepository } from "../ports/repositories.js";
import type { TransactionManager } from "../ports/transaction-manager.js";
import { activeWorkflow, WorkflowError } from "./start-death-workflow.js";

function repository(value: VersionedRepository | undefined, name: string): VersionedRepository {
  if (value === undefined) {
    throw new WorkflowError("DLS-WORKFLOW-UNAVAILABLE", `${name} is unavailable`, 503);
  }
  return value;
}

function actionFor(
  actions: readonly RepositoryRow[],
  contactId: string,
): Readonly<{ decision: string; decidedAt: string }> | null {
  const action = actions.find((row) => String(row.contact_id) === contactId);
  return action === undefined
    ? null
    : { decision: String(action.decision), decidedAt: String(action.created_at) };
}

export async function getOwnerWorkflow(transaction: TransactionManager) {
  return transaction.run(async (tx) => {
    const serverNow = await tx.clock.now();
    const workflows = (await tx.repositories.workflows.findMany?.()) ?? [];
    const workflow = activeWorkflow(workflows);
    if (workflow === undefined) return null;
    const contacts =
      (await repository(tx.repositories.workflowContacts, "workflow contacts").findMany?.(
        "workflow_id",
        String(workflow.id),
      )) ?? [];
    const actions =
      (await repository(tx.repositories.workflowContactActions, "workflow actions").findMany?.(
        "workflow_id",
        String(workflow.id),
      )) ?? [];
    return {
      workflowId: String(workflow.id),
      serverNow,
      kind: String(workflow.kind),
      state: String(workflow.state),
      startedAt: String(workflow.started_at),
      deadlineAt: String(workflow.deadline_snapshot_at),
      releaseAt: workflow.release_at == null ? null : String(workflow.release_at),
      contactCount: Number(workflow.contact_count_snapshot),
      requiredCount: Number(workflow.required_count_snapshot),
      approvedCount: Number(workflow.approved_count),
      generationId: String(workflow.share_generation_id),
      packageId: String(workflow.package_id),
      packageVersion: Number(workflow.package_version_snapshot),
      contacts: contacts
        .map((contact) => ({
          contactId: String(contact.contact_id),
          shareIndex: Number(contact.share_index),
          action: actionFor(actions, String(contact.contact_id)),
        }))
        .sort((left, right) => left.shareIndex - right.shareIndex),
    };
  });
}
