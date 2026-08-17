import { createHash } from "node:crypto";
import { isWorkflowDecision, WORKFLOW_DECISION } from "@dls/domain";
import type { RepositoryRow, VersionedRepository } from "../ports/repositories.js";
import type { TransactionContext } from "../ports/transaction-manager.js";
import { WorkflowError } from "./start-death-workflow.js";

export type SnapshotName = Readonly<{
  ciphertext: Uint8Array;
  nonce: Uint8Array;
  keyVersion: number;
}>;

export type OwnerDisplayNameReader = (snapshot: SnapshotName) => Promise<string>;
export type ContactPasswordVerifier = (password: string, encodedHash: string) => Promise<boolean>;

export function workflowRepository(
  value: VersionedRepository | undefined,
  name: string,
): VersionedRepository {
  if (value === undefined) {
    throw new WorkflowError("DLS-WORKFLOW-UNAVAILABLE", `${name} is unavailable`, 503);
  }
  return value;
}

export function ownedBytes(value: unknown, name: string, exact?: number, minimum = 1): Uint8Array {
  if (
    !(value instanceof Uint8Array) ||
    value.length < minimum ||
    (exact !== undefined && value.length !== exact)
  ) {
    throw new WorkflowError("DLS-CONTACT-ACTION-INVALID", `${name} is invalid`, 422);
  }
  return new Uint8Array(value);
}

export function positiveInteger(value: unknown, name: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new WorkflowError("DLS-CONTACT-ACTION-INVALID", `${name} is invalid`, 422);
  }
  return parsed;
}

export function sha256(value: string | Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(value).digest());
}

export function normalizedExact(value: string, expected: string): string {
  if (typeof value !== "string" || value.normalize("NFC") !== expected.normalize("NFC")) {
    throw new WorkflowError(
      "DLS-CONTACT-CONFIRMATION-TEXT",
      "confirmation text does not exactly match",
      400,
    );
  }
  return value.normalize("NFC");
}

export function ownerSnapshot(workflow: RepositoryRow): SnapshotName {
  return {
    ciphertext: ownedBytes(
      workflow.owner_display_name_snapshot_ciphertext,
      "owner display name ciphertext",
    ),
    nonce: ownedBytes(workflow.owner_display_name_snapshot_nonce, "owner display name nonce"),
    keyVersion: positiveInteger(
      workflow.owner_display_name_snapshot_key_version,
      "owner display name key version",
    ),
  };
}

export async function assertContactCanAct(
  tx: TransactionContext,
  workflowId: string,
  contactId: string,
  password: string,
  passwordVerifier: ContactPasswordVerifier,
  options: Readonly<{
    allowedStates?: readonly string[];
    requirePublishUnlocked?: boolean;
    allowExistingDeathDecision?: boolean;
  }> = {},
): Promise<
  Readonly<{
    workflow: RepositoryRow;
    contact: RepositoryRow;
    previousDecision: RepositoryRow | undefined;
  }>
> {
  const workflow = await tx.repositories.workflows.findById(workflowId, { forUpdate: true });
  if (workflow === null || workflow.kind !== "DEATH_CONFIRMATION") {
    throw new WorkflowError("DLS-CONTACT-ACTION-NOT-FOUND", "workflow was not found", 404);
  }
  const allowedStates = options.allowedStates ?? ["AWAITING_CONFIRMATIONS"];
  if (!allowedStates.includes(String(workflow.state))) {
    throw new WorkflowError(
      "DLS-CONTACT-ACTION-CLOSED",
      "contact decisions are closed for this workflow",
      409,
    );
  }
  if (
    options.requirePublishUnlocked === true &&
    workflow.publish_locked_at !== null &&
    workflow.publish_locked_at !== undefined
  ) {
    throw new WorkflowError(
      "DLS-RELEASE-LOCKED",
      "the publication is locked and can no longer be cancelled",
      409,
    );
  }
  const snapshots = workflowRepository(tx.repositories.workflowContacts, "workflow contacts");
  const roster = (await snapshots.findMany?.("workflow_id", workflowId, { forUpdate: true })) ?? [];
  if (!roster.some((row) => String(row.contact_id) === contactId)) {
    throw new WorkflowError(
      "DLS-CONTACT-ACTION-FORBIDDEN",
      "contact is not in the workflow snapshot",
      403,
    );
  }
  const contact = await tx.repositories.contacts.findById(contactId, { forUpdate: true });
  if (
    contact === null ||
    contact.status !== "ACTIVE" ||
    typeof contact.password_phc !== "string" ||
    typeof password !== "string" ||
    password.length === 0 ||
    !(await passwordVerifier(password, contact.password_phc))
  ) {
    throw new WorkflowError(
      "DLS-CONTACT-REAUTH-REQUIRED",
      "recent contact password reauthentication is required",
      401,
    );
  }
  const actions = workflowRepository(tx.repositories.workflowContactActions, "workflow actions");
  const existing = (await actions.findMany?.("workflow_id", workflowId, { forUpdate: true })) ?? [];
  const previousDecision = existing.find((row) => String(row.contact_id) === contactId);
  if (previousDecision !== undefined && !isWorkflowDecision(previousDecision.decision)) {
    throw new WorkflowError(
      "DLS-WORKFLOW-DATA-INTEGRITY",
      "stored workflow decision is invalid",
      500,
    );
  }
  if (
    previousDecision !== undefined &&
    !(
      options.allowExistingDeathDecision === true &&
      previousDecision.decision === WORKFLOW_DECISION.DEATH_LIKELY
    )
  ) {
    throw new WorkflowError(
      "DLS-CONTACT-ACTION-DUPLICATE",
      "contact already made a final decision",
      409,
    );
  }
  return { workflow, contact, previousDecision };
}

export async function reserveDecision<T>(
  tx: TransactionContext,
  input: Readonly<{
    contactId: string;
    commandName: string;
    requestId: string;
    requestIdentity: Readonly<Record<string, unknown>>;
  }>,
): Promise<Readonly<{ id: string; replay?: T }>> {
  const reservation = await tx.repositories.idempotency.reserve({
    actorScope: `CONTACT:${input.contactId}`,
    commandName: input.commandName,
    keyDigest: sha256(input.requestId),
    requestHash: sha256(JSON.stringify(input.requestIdentity)),
  });
  if (reservation.status === "COMPLETED") {
    return { id: reservation.id, replay: reservation.responseBody as T };
  }
  return { id: reservation.id };
}

export async function destroyWorkflowFragments(
  tx: TransactionContext,
  workflowId: string,
): Promise<void> {
  const fragments = workflowRepository(tx.repositories.workflowKeyFragments, "workflow fragments");
  const rows = (await fragments.findMany?.("workflow_id", workflowId, { forUpdate: true })) ?? [];
  for (const row of rows) {
    if (row.status === "DESTROYED") continue;
    await fragments.updateVersioned(row.id, Number(row.version ?? 0), {
      status: "DESTROYED",
      fragment_ciphertext: null,
      fragment_nonce: null,
      stage_key_version: null,
    });
  }
}
