import { isWorkflowDecision, WORKFLOW_DECISION } from "@dls/domain";
import type { RepositoryRow, VersionedRepository } from "../ports/repositories.js";
import type { WorkflowFragmentPurpose } from "../ports/stage-key-provider.js";
import type { TransactionManager } from "../ports/transaction-manager.js";
import { activeWorkflow, WorkflowError } from "./start-death-workflow.js";

export type OwnerDisplayNameSnapshot = Readonly<{
  ciphertext: Uint8Array;
  nonce: Uint8Array;
  keyVersion: number;
}>;

function repository(value: VersionedRepository | undefined, name: string): VersionedRepository {
  if (value === undefined) {
    throw new WorkflowError("DLS-WORKFLOW-UNAVAILABLE", `${name} is unavailable`, 503);
  }
  return value;
}

function bytes(value: unknown, name: string): Uint8Array {
  if (!(value instanceof Uint8Array) || value.length === 0) {
    throw new WorkflowError("DLS-WORKFLOW-SNAPSHOT-INVALID", `${name} is invalid`, 422);
  }
  return new Uint8Array(value);
}

function encode(value: unknown, name: string): string {
  return Buffer.from(bytes(value, name)).toString("base64url");
}

function purposeOf(workflow: RepositoryRow): WorkflowFragmentPurpose {
  if (workflow.kind === "DEATH_CONFIRMATION") return "DEATH";
  if (workflow.kind === "PASSWORD_RECOVERY") return "RECOVERY";
  throw new WorkflowError("DLS-WORKFLOW-SNAPSHOT-INVALID", "workflow kind is invalid", 422);
}

function legalActions(
  workflow: RepositoryRow,
  action: RepositoryRow | undefined,
): readonly ("CONFIRM_DEATH" | "CONFIRM_ALIVE" | "APPROVE_RECOVERY")[] {
  if (action !== undefined && !isWorkflowDecision(action.decision)) {
    throw new WorkflowError(
      "DLS-WORKFLOW-DATA-INTEGRITY",
      "stored workflow decision is invalid",
      500,
    );
  }
  if (workflow.kind === "DEATH_CONFIRMATION") {
    if (workflow.state === "AWAITING_CONFIRMATIONS") {
      if (action === undefined) return ["CONFIRM_DEATH", "CONFIRM_ALIVE"];
      return action.decision === WORKFLOW_DECISION.DEATH_LIKELY ? ["CONFIRM_ALIVE"] : [];
    }
    if (
      workflow.state === "RELEASE_PENDING" &&
      (workflow.publish_locked_at === null || workflow.publish_locked_at === undefined) &&
      (action === undefined || action.decision === WORKFLOW_DECISION.DEATH_LIKELY)
    ) {
      return ["CONFIRM_ALIVE"];
    }
  }
  if (
    action === undefined &&
    workflow.kind === "PASSWORD_RECOVERY" &&
    workflow.state === "AWAITING_APPROVALS"
  ) {
    return ["APPROVE_RECOVERY"];
  }
  return [];
}

export async function getContactWorkflow(
  contactId: string,
  dependencies: Readonly<{
    transaction: TransactionManager;
    ownerDisplayName: (snapshot: OwnerDisplayNameSnapshot) => Promise<string>;
    ingressPublicKey: (
      purpose: WorkflowFragmentPurpose,
    ) => Promise<Readonly<{ version: number; publicKey: Uint8Array }>>;
  }>,
) {
  return dependencies.transaction.run(async (tx) => {
    const workflows = (await tx.repositories.workflows.findMany?.()) ?? [];
    const workflow = activeWorkflow(workflows);
    if (workflow === undefined) return null;
    const contacts = repository(tx.repositories.workflowContacts, "workflow contacts");
    const snapshotRows = (await contacts.findMany?.("workflow_id", String(workflow.id))) ?? [];
    const snapshot = snapshotRows.find((row) => String(row.contact_id) === contactId);
    if (snapshot === undefined) return null;
    const actions = repository(tx.repositories.workflowContactActions, "workflow actions");
    const actionRows = (await actions.findMany?.("workflow_id", String(workflow.id))) ?? [];
    const action = actionRows.find((row) => String(row.contact_id) === contactId);
    const purpose = purposeOf(workflow);
    const shares = repository(tx.repositories.contactKeyShares, "contact key shares");
    const generationRows =
      (await shares.findMany?.("generation_id", String(workflow.share_generation_id))) ?? [];
    const share = generationRows.find((row) => String(row.contact_id) === contactId);
    if (share === undefined || Number(share.share_index) !== Number(snapshot.share_index)) {
      throw new WorkflowError("DLS-WORKFLOW-SNAPSHOT-INVALID", "contact share is unavailable", 422);
    }
    const ingress = await dependencies.ingressPublicKey(purpose);
    const ownerDisplayName = await dependencies.ownerDisplayName({
      ciphertext: bytes(
        workflow.owner_display_name_snapshot_ciphertext,
        "owner display name ciphertext",
      ),
      nonce: bytes(workflow.owner_display_name_snapshot_nonce, "owner display name nonce"),
      keyVersion: Number(workflow.owner_display_name_snapshot_key_version),
    });
    return {
      workflowId: String(workflow.id),
      kind: String(workflow.kind),
      state: String(workflow.state),
      ownerDisplayName,
      startedAt: String(workflow.started_at),
      expiresAt: workflow.expires_at == null ? null : String(workflow.expires_at),
      approvedCount: Number(workflow.approved_count),
      requiredCount: Number(workflow.required_count_snapshot),
      decisionAlreadyMade: action !== undefined,
      legalNextActions: legalActions(workflow, action),
      share: {
        generationId: String(workflow.share_generation_id),
        shareIndex: Number(share.share_index),
        protocolVersion: Number(share.share_protocol_version),
        ciphertext: encode(
          purpose === "DEATH" ? share.death_share_ciphertext : share.recovery_share_ciphertext,
          "contact share ciphertext",
        ),
        commitment: encode(
          purpose === "DEATH" ? share.death_share_commitment : share.recovery_share_commitment,
          "contact share commitment",
        ),
      },
      ingress: {
        purpose,
        version: ingress.version,
        publicKey: Buffer.from(ingress.publicKey).toString("base64url"),
      },
    };
  });
}
