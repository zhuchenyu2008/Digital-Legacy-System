import { parseInstant } from "@dls/domain";
import type { RepositoryRow, VersionedRepository } from "../ports/repositories.js";
import type { TransactionContext, TransactionManager } from "../ports/transaction-manager.js";
import { cancelActiveRecovery } from "../recovery/recovery-common.js";

const TERMINAL_STATES = new Set(["COMPLETED", "CANCELLED", "EXPIRED", "RELEASED"]);

export class WorkflowError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly status = 409,
  ) {
    super(message);
    this.name = "WorkflowError";
  }
}

export type StartDeathWorkflowCommand = Readonly<{
  scheduleId: string;
  scheduleVersion: number;
}>;

export type DeathWorkflowStartResult =
  | Readonly<{ status: "STARTED"; workflowId: string }>
  | Readonly<{ status: "ALREADY_STARTED"; workflowId: string }>
  | Readonly<{ status: "NOT_ARMED" }>
  | Readonly<{ status: "STALE" }>;

function requiredRepository(
  value: VersionedRepository | undefined,
  name: string,
): VersionedRepository {
  if (value === undefined) {
    throw new WorkflowError("DLS-WORKFLOW-UNAVAILABLE", `${name} is unavailable`, 503);
  }
  return value;
}

function bytes(value: unknown, name: string, exact?: number): Uint8Array {
  if (!(value instanceof Uint8Array) || value.length === 0 || (exact && value.length !== exact)) {
    throw new WorkflowError("DLS-WORKFLOW-SNAPSHOT-INVALID", `${name} is invalid`, 422);
  }
  return new Uint8Array(value);
}

function positiveInteger(value: unknown, name: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new WorkflowError("DLS-WORKFLOW-SNAPSHOT-INVALID", `${name} is invalid`, 422);
  }
  return parsed;
}

export function activeWorkflow(rows: readonly RepositoryRow[]): RepositoryRow | undefined {
  return rows.find((row) => !TERMINAL_STATES.has(String(row.state)));
}

export async function startDeathWorkflowInTransaction(
  command: StartDeathWorkflowCommand,
  dependencies: Readonly<{
    tx: TransactionContext;
    now: string;
    currentWorkflows: readonly RepositoryRow[];
    idFactory: () => string;
  }>,
): Promise<DeathWorkflowStartResult> {
  const { tx, now } = dependencies;
  const existingDeath = dependencies.currentWorkflows.find(
    (row) => row.kind === "DEATH_CONFIRMATION" && !TERMINAL_STATES.has(String(row.state)),
  );
  if (existingDeath !== undefined) {
    return { status: "ALREADY_STARTED", workflowId: String(existingDeath.id) };
  }

  const owner = await tx.repositories.ownerProfile.findById(true, { forUpdate: true });
  if (owner === null || owner.setup_state !== "ARMED") return { status: "NOT_ARMED" };
  const settings = await tx.repositories.systemSettings.findById(true, { forUpdate: true });
  if (settings === null) {
    throw new WorkflowError("DLS-WORKFLOW-SNAPSHOT-INVALID", "system settings are unavailable");
  }

  const recovery = dependencies.currentWorkflows.find(
    (row) => row.kind === "PASSWORD_RECOVERY" && !TERMINAL_STATES.has(String(row.state)),
  );
  if (recovery !== undefined) await cancelActiveRecovery(tx, now, "DEATH_WORKFLOW_PRIORITY");

  const generations = requiredRepository(tx.repositories.shareGenerations, "share generations");
  const generation = await generations.findOneBy?.("status", "ACTIVE", { forUpdate: true });
  if (generation === null || generation === undefined) {
    throw new WorkflowError("DLS-WORKFLOW-SNAPSHOT-INVALID", "active generation is unavailable");
  }
  const generationId = String(generation.id);
  const vault = await tx.repositories.vaults.findById(String(generation.vault_id), {
    forUpdate: true,
  });
  if (vault === null || String(vault.active_share_generation_id) !== generationId) {
    throw new WorkflowError(
      "DLS-WORKFLOW-SNAPSHOT-INVALID",
      "active vault generation is unavailable",
    );
  }
  const activePackage = await tx.repositories.packages.findOneBy?.("status", "ACTIVE", {
    forUpdate: true,
  });
  if (activePackage === null || activePackage === undefined) {
    throw new WorkflowError("DLS-WORKFLOW-SNAPSHOT-INVALID", "active package is unavailable");
  }

  const contacts = [
    ...((await tx.repositories.contacts.findMany?.("status", "ACTIVE", {
      forUpdate: true,
    })) ?? []),
  ].sort((left, right) => String(left.id).localeCompare(String(right.id)));
  const contactCount = positiveInteger(generation.contact_count, "generation contact count");
  const threshold = positiveInteger(generation.death_threshold, "death threshold");
  if (contacts.length !== contactCount || threshold > contactCount) {
    throw new WorkflowError(
      "DLS-WORKFLOW-SNAPSHOT-INVALID",
      "active contact roster does not match the generation",
    );
  }
  const keyShares = requiredRepository(tx.repositories.contactKeyShares, "contact key shares");
  const shares =
    (await keyShares.findMany?.("generation_id", generationId, { forUpdate: true })) ?? [];
  if (shares.length !== contactCount) {
    throw new WorkflowError(
      "DLS-WORKFLOW-SNAPSHOT-INVALID",
      "generation share roster is incomplete",
    );
  }

  const workflowId = dependencies.idFactory();
  const workflowContacts = requiredRepository(
    tx.repositories.workflowContacts,
    "workflow contacts",
  );
  const schedule = await tx.repositories.checkinSchedules.findById(command.scheduleId, {
    forUpdate: true,
  });
  if (schedule === null) {
    throw new WorkflowError("DLS-WORKFLOW-SNAPSHOT-INVALID", "check-in schedule is unavailable");
  }
  await tx.repositories.workflows.insert({
    id: workflowId,
    kind: "DEATH_CONFIRMATION",
    state: "AWAITING_CONFIRMATIONS",
    contact_count_snapshot: contactCount,
    required_count_snapshot: threshold,
    approved_count: 0,
    share_generation_id: generationId,
    package_id: activePackage.id,
    package_version_snapshot: positiveInteger(activePackage.version_no, "package version"),
    schedule_version_snapshot: command.scheduleVersion,
    deadline_snapshot_at: parseInstant(String(schedule.deadline_at)),
    owner_display_name_snapshot_ciphertext: bytes(
      owner.display_name_ciphertext,
      "owner display name ciphertext",
    ),
    owner_display_name_snapshot_nonce: bytes(owner.display_name_nonce, "owner display name nonce"),
    owner_display_name_snapshot_key_version: positiveInteger(
      owner.display_name_key_version,
      "owner display name key version",
    ),
    started_at: now,
  });

  for (const [position, contact] of contacts.entries()) {
    const share = shares.find((row) => String(row.contact_id) === String(contact.id));
    if (share === undefined) {
      throw new WorkflowError("DLS-WORKFLOW-SNAPSHOT-INVALID", "contact share is missing");
    }
    await workflowContacts.insert({
      workflow_id: workflowId,
      contact_id: contact.id,
      snapshot_position: position + 1,
      share_index: positiveInteger(share.share_index, "share index"),
      contact_public_key: bytes(contact.x25519_public_key, "contact public key", 32),
      contact_set_version: positiveInteger(settings.contact_set_version, "contact set version"),
      display_name_snapshot_ciphertext: bytes(
        contact.display_name_ciphertext,
        "contact display name ciphertext",
      ),
      display_name_snapshot_nonce: bytes(contact.display_name_nonce, "contact display name nonce"),
      display_name_snapshot_key_version: positiveInteger(
        contact.display_name_key_version,
        "contact display name key version",
      ),
      email_snapshot_ciphertext: bytes(contact.email_ciphertext, "contact email ciphertext"),
      email_snapshot_nonce: bytes(contact.email_nonce, "contact email nonce"),
      email_snapshot_key_version: positiveInteger(
        contact.email_key_version,
        "contact email key version",
      ),
      email_snapshot_lookup_hmac: bytes(contact.email_lookup_hmac, "contact email lookup HMAC", 32),
    });
    await tx.outbox.enqueue({
      eventType: "DEATH_CONFIRMATION_INVITATION_REQUESTED",
      aggregateType: "workflow",
      aggregateId: workflowId,
      payload: {
        aggregateId: workflowId,
        aggregateVersion: 0,
        workflowId,
        contactId: String(contact.id),
      },
      idempotencyKey: `death-invitation:${workflowId}:${String(contact.id)}`,
      availableAt: now,
    });
  }
  await tx.audit.append({
    eventId: dependencies.idFactory(),
    occurredAt: now,
    eventType: "DEATH_WORKFLOW_STARTED",
    actorType: "SYSTEM",
    aggregateType: "workflow",
    aggregateId: workflowId,
    result: "SUCCESS",
    metadata: { contactCount, threshold, packageVersion: activePackage.version_no },
  });
  await tx.outbox.enqueue({
    eventType: "DEATH_WORKFLOW_STARTED",
    aggregateType: "workflow",
    aggregateId: workflowId,
    payload: { aggregateId: workflowId, aggregateVersion: 0 },
    idempotencyKey: `death-workflow-started:${workflowId}`,
    availableAt: now,
  });
  return { status: "STARTED", workflowId };
}

export async function startDeathWorkflow(
  command: StartDeathWorkflowCommand,
  dependencies: Readonly<{ transaction: TransactionManager; idFactory?: () => string }>,
): Promise<DeathWorkflowStartResult> {
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
    const now = await tx.clock.now();
    return startDeathWorkflowInTransaction(command, { tx, now, currentWorkflows, idFactory });
  });
}
