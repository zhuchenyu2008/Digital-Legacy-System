import { createHash, timingSafeEqual } from "node:crypto";
import type { RepositoryRow, VersionedRepository } from "../ports/repositories.js";
import type {
  FragmentCryptography,
  FragmentEnvelopeContext,
  FragmentVerificationContext,
  StageKeyProvider,
  WorkflowFragmentPurpose,
} from "../ports/stage-key-provider.js";
import type { TransactionManager } from "../ports/transaction-manager.js";

const ACTIVE_FRAGMENT_STATES: Readonly<Record<WorkflowFragmentPurpose, string>> = {
  DEATH: "AWAITING_CONFIRMATIONS",
  RECOVERY: "AWAITING_APPROVALS",
};

const PURPOSE_WORKFLOW_KIND: Readonly<Record<WorkflowFragmentPurpose, string>> = {
  DEATH: "DEATH_CONFIRMATION",
  RECOVERY: "PASSWORD_RECOVERY",
};

export class WorkflowFragmentError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly status = 422,
  ) {
    super(message);
    this.name = "WorkflowFragmentError";
  }
}

export type SubmitFragmentCommand = Readonly<{
  workflowId: string;
  contactId: string;
  generationId: string;
  shareIndex: number;
  purpose: WorkflowFragmentPurpose;
  commitmentDigest: Uint8Array;
  ingressKeyVersion: number;
  protocolVersion: 1;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
  requestId: string;
}>;

export type ProcessSubmittedFragmentCommand = Readonly<{
  workflowId: string;
  contactId: string;
  fragmentId: string;
}>;

export type FragmentLifecycleResult = Readonly<{
  fragmentId: string;
  status: "PENDING" | "VALIDATED" | "REJECTED" | "DESTROYED";
}>;

function repository(value: VersionedRepository | undefined, name: string): VersionedRepository {
  if (value === undefined) {
    throw new WorkflowFragmentError(
      "DLS-FRAGMENT-UNAVAILABLE",
      `${name} repository is unavailable`,
      503,
    );
  }
  return value;
}

function bytes(value: unknown, field: string, exact?: number, minimum = 1): Uint8Array {
  if (
    !(value instanceof Uint8Array) ||
    value.length < minimum ||
    (exact !== undefined && value.length !== exact)
  ) {
    throw new WorkflowFragmentError("DLS-FRAGMENT-CONTEXT", `${field} is invalid`);
  }
  return new Uint8Array(value);
}

function positiveInteger(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new WorkflowFragmentError("DLS-FRAGMENT-CONTEXT", `${field} is invalid`);
  }
  return parsed;
}

function digest(value: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(value).digest());
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

function assertWorkflowContext(
  workflow: RepositoryRow,
  command: Pick<SubmitFragmentCommand, "generationId" | "purpose">,
): void {
  if (
    workflow.kind !== PURPOSE_WORKFLOW_KIND[command.purpose] ||
    workflow.state !== ACTIVE_FRAGMENT_STATES[command.purpose] ||
    String(workflow.share_generation_id) !== command.generationId
  ) {
    throw new WorkflowFragmentError(
      "DLS-FRAGMENT-CONTEXT",
      "fragment workflow context is stale or mixed",
      409,
    );
  }
}

async function findSnapshotRow(
  repositoryValue: VersionedRepository,
  field: string,
  value: string,
  predicate: (row: RepositoryRow) => boolean,
  forUpdate = false,
): Promise<RepositoryRow | null> {
  const rows = (await repositoryValue.findMany?.(field, value, { forUpdate })) ?? [];
  return rows.find(predicate) ?? null;
}

function shareCommitment(row: RepositoryRow, purpose: WorkflowFragmentPurpose): Uint8Array {
  return bytes(
    purpose === "DEATH" ? row.death_share_commitment : row.recovery_share_commitment,
    "share commitment",
  );
}

async function validateSnapshot(
  tx: Parameters<Parameters<TransactionManager["run"]>[0]>[0],
  input: Pick<
    SubmitFragmentCommand,
    "workflowId" | "contactId" | "generationId" | "shareIndex" | "purpose"
  >,
  forUpdate: boolean,
) {
  const workflow = await tx.repositories.workflows.findById(input.workflowId, { forUpdate });
  if (workflow === null) {
    throw new WorkflowFragmentError("DLS-FRAGMENT-CONTEXT", "workflow was not found", 404);
  }
  assertWorkflowContext(workflow, input);

  const workflowContacts = repository(tx.repositories.workflowContacts, "workflow contacts");
  const workflowContact = await findSnapshotRow(
    workflowContacts,
    "workflow_id",
    input.workflowId,
    (row) => String(row.contact_id) === input.contactId,
    forUpdate,
  );
  if (workflowContact === null) {
    throw new WorkflowFragmentError(
      "DLS-FRAGMENT-CONTEXT",
      "contact is not in the workflow snapshot",
      403,
    );
  }

  const generationRepository = repository(tx.repositories.shareGenerations, "share generations");
  const generation = await generationRepository.findById(input.generationId, { forUpdate });
  if (generation === null || generation.status !== "ACTIVE") {
    throw new WorkflowFragmentError("DLS-FRAGMENT-CONTEXT", "share generation is stale", 409);
  }

  const keyShares = repository(tx.repositories.contactKeyShares, "contact key shares");
  const keyShare = await findSnapshotRow(
    keyShares,
    "generation_id",
    input.generationId,
    (row) =>
      String(row.contact_id) === input.contactId && Number(row.share_index) === input.shareIndex,
    forUpdate,
  );
  if (keyShare === null) {
    throw new WorkflowFragmentError(
      "DLS-FRAGMENT-CONTEXT",
      "share index does not match the workflow snapshot",
      409,
    );
  }

  const vault = await tx.repositories.vaults.findById(String(generation.vault_id), { forUpdate });
  if (vault === null) {
    throw new WorkflowFragmentError("DLS-FRAGMENT-CONTEXT", "vault was not found", 409);
  }
  return { workflow, generation, keyShare, vault };
}

export async function submitFragment(
  command: SubmitFragmentCommand,
  dependencies: Readonly<{ transaction: TransactionManager; idFactory?: () => string }>,
): Promise<FragmentLifecycleResult> {
  const idFactory = dependencies.idFactory ?? (() => crypto.randomUUID());
  const nonce = bytes(command.nonce, "fragment nonce", 24);
  const ciphertext = bytes(command.ciphertext, "fragment ciphertext", undefined, 49);
  const commitmentDigest = bytes(command.commitmentDigest, "commitment digest", 32);
  positiveInteger(command.shareIndex, "share index");
  positiveInteger(command.ingressKeyVersion, "ingress key version");
  if (command.protocolVersion !== 1) {
    throw new WorkflowFragmentError("DLS-FRAGMENT-CONTEXT", "protocol version is unsupported");
  }

  try {
    return await dependencies.transaction.run(
      async (tx) => {
        const { keyShare } = await validateSnapshot(tx, command, true);
        const expectedCommitment = shareCommitment(keyShare, command.purpose);
        const expectedDigest = digest(expectedCommitment);
        if (!equalBytes(commitmentDigest, expectedDigest)) {
          throw new WorkflowFragmentError(
            "DLS-FRAGMENT-CONTEXT",
            "commitment digest does not match the snapshot",
            409,
          );
        }

        const fragments = repository(
          tx.repositories.workflowKeyFragments,
          "workflow key fragments",
        );
        const existing = await findSnapshotRow(
          fragments,
          "workflow_id",
          command.workflowId,
          (row) => String(row.contact_id) === command.contactId && row.purpose === command.purpose,
          true,
        );
        if (existing !== null) {
          throw new WorkflowFragmentError(
            "DLS-FRAGMENT-DUPLICATE",
            "contact already submitted this workflow fragment",
            409,
          );
        }

        const fragmentId = idFactory();
        const now = await tx.clock.now();
        await fragments.insert({
          id: fragmentId,
          workflow_id: command.workflowId,
          contact_id: command.contactId,
          purpose: command.purpose,
          generation_id: command.generationId,
          share_index: command.shareIndex,
          fragment_ciphertext: ciphertext,
          fragment_nonce: nonce,
          fragment_commitment: expectedCommitment,
          fragment_commitment_digest: commitmentDigest,
          status: "PENDING",
          ingress_key_version: command.ingressKeyVersion,
          stage_key_version: null,
          protocol_version: 1,
          created_at: now,
          updated_at: now,
        });
        await tx.audit.append({
          eventId: crypto.randomUUID(),
          occurredAt: now,
          eventType: "WORKFLOW_FRAGMENT_SUBMITTED",
          actorType: "CONTACT",
          actorIdDigest: digest(new TextEncoder().encode(command.contactId)),
          aggregateType: "workflow",
          aggregateId: command.workflowId,
          requestId: command.requestId,
          result: "SUCCESS",
          metadata: { fragmentId, purpose: command.purpose },
        });
        await tx.outbox.enqueue({
          eventType: "WORKFLOW_FRAGMENT_SUBMITTED",
          aggregateType: "workflow",
          aggregateId: command.workflowId,
          payload: { workflowId: command.workflowId, contactId: command.contactId, fragmentId },
          idempotencyKey: `workflow-fragment:${fragmentId}`,
          availableAt: now,
        });
        return { fragmentId, status: "PENDING" };
      },
      { isolation: "serializable" },
    );
  } finally {
    nonce.fill(0);
    ciphertext.fill(0);
    commitmentDigest.fill(0);
  }
}

function lifecycleStatus(value: unknown): FragmentLifecycleResult["status"] {
  if (
    value === "PENDING" ||
    value === "VALIDATED" ||
    value === "REJECTED" ||
    value === "DESTROYED"
  ) {
    return value;
  }
  throw new WorkflowFragmentError("DLS-FRAGMENT-CONTEXT", "fragment status is invalid", 409);
}

async function rejectFragment(
  fragments: VersionedRepository,
  fragment: RepositoryRow,
): Promise<FragmentLifecycleResult> {
  await fragments.updateVersioned(fragment.id, Number(fragment.version ?? 0), {
    status: "REJECTED",
    fragment_ciphertext: null,
    fragment_nonce: null,
    stage_key_version: null,
  });
  return { fragmentId: String(fragment.id), status: "REJECTED" };
}

export async function processSubmittedFragment(
  command: ProcessSubmittedFragmentCommand,
  dependencies: Readonly<{
    transaction: TransactionManager;
    stageKeys: StageKeyProvider;
    cryptography: FragmentCryptography;
  }>,
): Promise<FragmentLifecycleResult> {
  return dependencies.transaction.run(
    async (tx) => {
      const fragments = repository(tx.repositories.workflowKeyFragments, "workflow key fragments");
      const fragment = await fragments.findById(command.fragmentId, { forUpdate: true });
      if (
        fragment === null ||
        String(fragment.workflow_id) !== command.workflowId ||
        String(fragment.contact_id) !== command.contactId
      ) {
        throw new WorkflowFragmentError("DLS-FRAGMENT-CONTEXT", "fragment was not found", 404);
      }
      const status = lifecycleStatus(fragment.status);
      if (status !== "PENDING") return { fragmentId: command.fragmentId, status };

      let purpose: WorkflowFragmentPurpose;
      if (fragment.purpose === "DEATH") {
        purpose = "DEATH";
      } else if (fragment.purpose === "RECOVERY") {
        purpose = "RECOVERY";
      } else {
        return rejectFragment(fragments, fragment);
      }
      const snapshotInput = {
        workflowId: command.workflowId,
        contactId: command.contactId,
        generationId: String(fragment.generation_id),
        shareIndex: positiveInteger(fragment.share_index, "share index"),
        purpose,
      };
      const { generation, keyShare, vault } = await validateSnapshot(tx, snapshotInput, true);
      const storedCommitment = bytes(fragment.fragment_commitment, "share commitment");
      const expectedCommitment = shareCommitment(keyShare, purpose);
      const storedDigest = bytes(fragment.fragment_commitment_digest, "commitment digest", 32);
      if (
        !equalBytes(storedCommitment, expectedCommitment) ||
        !equalBytes(storedDigest, digest(expectedCommitment))
      ) {
        storedCommitment.fill(0);
        expectedCommitment.fill(0);
        storedDigest.fill(0);
        return rejectFragment(fragments, fragment);
      }

      const ingressKeyVersion = positiveInteger(
        fragment.ingress_key_version,
        "ingress key version",
      );
      const providedPair = await dependencies.stageKeys.ingressKeyPair(purpose, ingressKeyVersion);
      if (providedPair.version !== ingressKeyVersion) {
        throw new WorkflowFragmentError(
          "DLS-FRAGMENT-KEY-VERSION",
          "ingress key provider returned the wrong version",
          503,
        );
      }
      const publicKey = bytes(providedPair.publicKey, "ingress public key", 32);
      const privateKey = bytes(providedPair.privateKey, "ingress private key", 32);
      const nonce = bytes(fragment.fragment_nonce, "fragment nonce", 24);
      const ciphertext = bytes(fragment.fragment_ciphertext, "fragment ciphertext", undefined, 49);
      const envelopeContext: FragmentEnvelopeContext = {
        ...snapshotInput,
        commitmentDigest: storedDigest,
        ingressKeyVersion,
      };
      let plaintextShare: Uint8Array | undefined;
      let stageKey: Uint8Array | undefined;
      try {
        try {
          plaintextShare = await dependencies.cryptography.openIngress({
            context: envelopeContext,
            envelope: { protocolVersion: 1, nonce, ciphertext },
            keyPair: { version: ingressKeyVersion, publicKey, privateKey },
          });
          if (!(plaintextShare instanceof Uint8Array) || plaintextShare.length === 0) {
            throw new Error("invalid plaintext share");
          }
        } catch {
          return await rejectFragment(fragments, fragment);
        }

        const verificationContext: FragmentVerificationContext = {
          ...envelopeContext,
          vaultId: String(generation.vault_id),
          threshold: positiveInteger(
            purpose === "DEATH" ? generation.death_threshold : generation.recovery_threshold,
            "threshold",
          ),
          shareCount: positiveInteger(generation.contact_count, "share count"),
          shareCommitment: storedCommitment,
          generationCommitment: bytes(generation.generation_commitment, "generation commitment"),
          vkCommitment: bytes(vault.vk_commitment, "vault key commitment", 32),
        };
        let valid = false;
        try {
          valid = await dependencies.cryptography.verifyShare({
            context: verificationContext,
            plaintextShare,
          });
        } catch {
          valid = false;
        }
        if (!valid) return await rejectFragment(fragments, fragment);

        const providedStage = await dependencies.stageKeys.currentStageKey(purpose);
        const stageKeyVersion = positiveInteger(providedStage.version, "stage key version");
        stageKey = bytes(providedStage.key, "stage key", 32);
        const wrapped = await dependencies.cryptography.wrapStage({
          context: envelopeContext,
          plaintextShare,
          stageKey,
          stageKeyVersion,
        });
        if (wrapped.protocolVersion !== 1) {
          throw new WorkflowFragmentError(
            "DLS-FRAGMENT-KEY-VERSION",
            "stage wrapper returned an unsupported protocol version",
            503,
          );
        }
        const stageNonce = bytes(wrapped.nonce, "stage nonce", 24);
        const stageCiphertext = bytes(wrapped.ciphertext, "stage ciphertext", undefined, 17);
        try {
          await fragments.updateVersioned(fragment.id, Number(fragment.version ?? 0), {
            status: "VALIDATED",
            stage_key_version: stageKeyVersion,
            protocol_version: 1,
            fragment_nonce: stageNonce,
            fragment_ciphertext: stageCiphertext,
          });
        } finally {
          stageNonce.fill(0);
          stageCiphertext.fill(0);
        }
        return { fragmentId: command.fragmentId, status: "VALIDATED" };
      } finally {
        publicKey.fill(0);
        privateKey.fill(0);
        nonce.fill(0);
        ciphertext.fill(0);
        plaintextShare?.fill(0);
        stageKey?.fill(0);
        storedCommitment.fill(0);
        expectedCommitment.fill(0);
        storedDigest.fill(0);
      }
    },
    { isolation: "serializable" },
  );
}
