import { timingSafeEqual } from "node:crypto";
import { addExactDays, parseInstant } from "@dls/domain";
import type { RepositoryRow } from "../ports/repositories.js";
import type {
  FragmentCryptography,
  StageKeyProvider,
  VersionedStageKey,
} from "../ports/stage-key-provider.js";
import type { TransactionManager } from "../ports/transaction-manager.js";
import {
  destroyWorkflowFragments,
  ownedBytes,
  positiveInteger,
  sha256,
  workflowRepository,
} from "./contact-decision-common.js";
import { processSubmittedFragment, WorkflowFragmentError } from "./submit-fragment.js";

export interface ReleaseFragmentCryptography {
  openStage(
    input: Readonly<{ fragment: RepositoryRow; stageKey: Uint8Array }>,
  ): Promise<Uint8Array>;
  verifyShare(
    input: Readonly<{
      fragment: RepositoryRow;
      share: Uint8Array;
      generation: RepositoryRow;
      vault: RepositoryRow;
    }>,
  ): Promise<boolean>;
  reconstruct(
    input: Readonly<{
      shares: readonly Uint8Array[];
      fragments: readonly RepositoryRow[];
      generation: RepositoryRow;
      vault: RepositoryRow;
    }>,
  ): Promise<Uint8Array>;
  commitVaultKey(vaultKey: Uint8Array): Promise<Uint8Array>;
  wrapReleaseVaultKey(
    input: Readonly<{
      workflowId: string;
      vaultId: string;
      vaultKey: Uint8Array;
      stageKey: Uint8Array;
      stageKeyVersion: number;
    }>,
  ): Promise<Readonly<{ protocolVersion: 1; nonce: Uint8Array; ciphertext: Uint8Array }>>;
}

export type ProcessReleaseFragmentResult =
  | Readonly<{ status: "REJECTED" | "CLOSED" }>
  | Readonly<{
      status: "RECORDED";
      approvedCount: number;
      thresholdReached: false;
      workflowState: "AWAITING_CONFIRMATIONS";
    }>
  | Readonly<{
      status: "RELEASE_PENDING";
      approvedCount: number;
      thresholdReached: true;
      workflowState: "RELEASE_PENDING";
      releaseAt: string;
    }>;

async function keyForVersion(
  provider: StageKeyProvider,
  version: number,
): Promise<VersionedStageKey> {
  const provided =
    provider.stageKey === undefined
      ? await provider.currentStageKey("DEATH")
      : await provider.stageKey("DEATH", version);
  if (provided.version !== version) {
    throw new WorkflowFragmentError(
      "DLS-FRAGMENT-KEY-VERSION",
      "stage key provider returned the wrong version",
      503,
    );
  }
  return provided;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

function releaseResult(workflow: RepositoryRow): ProcessReleaseFragmentResult {
  if (workflow.state !== "RELEASE_PENDING" || typeof workflow.release_at !== "string") {
    return { status: "CLOSED" };
  }
  return {
    status: "RELEASE_PENDING",
    approvedCount: Number(workflow.approved_count),
    thresholdReached: true,
    workflowState: "RELEASE_PENDING",
    releaseAt: parseInstant(workflow.release_at),
  };
}

const REMINDER_OFFSETS_MS = [
  0,
  5 * 60_000,
  15 * 60_000,
  30 * 60_000,
  60 * 60_000,
  2 * 60 * 60_000,
  4 * 60 * 60_000,
  8 * 60 * 60_000,
  12 * 60 * 60_000,
  18 * 60 * 60_000,
  23 * 60 * 60_000,
  23 * 60 * 60_000 + 50 * 60_000,
] as const;

export async function processReleaseFragment(
  command: Readonly<{ fragmentId: string }>,
  dependencies: Readonly<{
    transaction: TransactionManager;
    stageKeys: StageKeyProvider;
    fragmentCryptography: FragmentCryptography;
    releaseCryptography: ReleaseFragmentCryptography;
    idFactory?: () => string;
  }>,
): Promise<ProcessReleaseFragmentResult> {
  const processed = await processSubmittedFragment(
    { fragmentId: command.fragmentId },
    {
      transaction: dependencies.transaction,
      stageKeys: dependencies.stageKeys,
      cryptography: dependencies.fragmentCryptography,
    },
  );
  if (processed.status === "REJECTED") return { status: "REJECTED" };

  const idFactory = dependencies.idFactory ?? (() => crypto.randomUUID());
  return dependencies.transaction.run(
    async (tx) => {
      const fragments = workflowRepository(
        tx.repositories.workflowKeyFragments,
        "workflow fragments",
      );
      const fragment = await fragments.findById(command.fragmentId, { forUpdate: true });
      if (fragment === null) {
        throw new WorkflowFragmentError("DLS-FRAGMENT-CONTEXT", "fragment was not found", 404);
      }
      const workflowId = String(fragment.workflow_id);
      const workflow = await tx.repositories.workflows.findById(workflowId, { forUpdate: true });
      if (workflow === null) {
        throw new WorkflowFragmentError("DLS-FRAGMENT-CONTEXT", "workflow was not found", 404);
      }
      if (workflow.state === "RELEASE_PENDING") return releaseResult(workflow);
      if (workflow.state !== "AWAITING_CONFIRMATIONS" || fragment.status === "DESTROYED") {
        return { status: "CLOSED" };
      }
      if (fragment.status !== "VALIDATED" || fragment.purpose !== "DEATH") {
        throw new WorkflowFragmentError(
          "DLS-FRAGMENT-CONTEXT",
          "fragment is not validated for death release",
          409,
        );
      }
      const actions = workflowRepository(
        tx.repositories.workflowContactActions,
        "workflow actions",
      );
      const currentActions =
        (await actions.findMany?.("workflow_id", workflowId, { forUpdate: true })) ?? [];
      const contactId = String(fragment.contact_id);
      const existing = currentActions.find((row) => String(row.contact_id) === contactId);
      if (existing === undefined) {
        const decisionDigest = ownedBytes(fragment.decision_digest, "decision digest", 32);
        const actionAt = await tx.clock.now();
        try {
          await actions.insert({
            id: idFactory(),
            workflow_id: workflowId,
            contact_id: contactId,
            decision: "DEATH_LIKELY",
            decision_digest: decisionDigest,
            created_at: actionAt,
          });
          const actorDigest = sha256(contactId);
          try {
            await tx.audit.append({
              eventId: crypto.randomUUID(),
              occurredAt: actionAt,
              eventType: "DEATH_CONFIRMATION_RECORDED",
              actorType: "CONTACT",
              actorIdDigest: actorDigest,
              aggregateType: "workflow",
              aggregateId: workflowId,
              result: "SUCCESS",
              metadata: { fragmentId: command.fragmentId },
            });
          } finally {
            actorDigest.fill(0);
          }
        } finally {
          decisionDigest.fill(0);
        }
      } else if (existing.decision !== "DEATH_LIKELY") {
        return { status: "CLOSED" };
      } else {
        return {
          status: "RECORDED",
          approvedCount: currentActions.filter((row) => row.decision === "DEATH_LIKELY").length,
          thresholdReached: false,
          workflowState: "AWAITING_CONFIRMATIONS",
        };
      }
      const recordedActions =
        (await actions.findMany?.("workflow_id", workflowId, { forUpdate: true })) ?? [];
      const approvedActions = recordedActions.filter((row) => row.decision === "DEATH_LIKELY");
      const approvedCount = approvedActions.length;
      const requiredCount = positiveInteger(workflow.required_count_snapshot, "required count");
      if (approvedCount < requiredCount) {
        await tx.repositories.workflows.updateVersioned(workflowId, Number(workflow.version ?? 0), {
          approved_count: approvedCount,
        });
        await tx.outbox.enqueue({
          eventType: "DEATH_CONFIRMATION_RECORDED",
          aggregateType: "workflow",
          aggregateId: workflowId,
          payload: {
            aggregateId: workflowId,
            aggregateVersion: Number(workflow.version ?? 0) + 1,
          },
          idempotencyKey: `death-confirmation:${workflowId}:${contactId}`,
          availableAt: await tx.clock.now(),
        });
        return {
          status: "RECORDED",
          approvedCount,
          thresholdReached: false,
          workflowState: "AWAITING_CONFIRMATIONS",
        };
      }

      const generation = await workflowRepository(
        tx.repositories.shareGenerations,
        "share generations",
      ).findById(String(workflow.share_generation_id), { forUpdate: true });
      if (generation === null) throw new Error("share generation is unavailable");
      const vault = await tx.repositories.vaults.findById(String(generation.vault_id), {
        forUpdate: true,
      });
      if (vault === null) throw new Error("vault is unavailable");
      const allFragments =
        (await fragments.findMany?.("workflow_id", workflowId, { forUpdate: true })) ?? [];
      const approvedIds = new Set(approvedActions.map((row) => String(row.contact_id)));
      const selected = allFragments
        .filter(
          (row) =>
            row.status === "VALIDATED" &&
            row.purpose === "DEATH" &&
            approvedIds.has(String(row.contact_id)),
        )
        .sort((left, right) => Number(left.share_index) - Number(right.share_index))
        .slice(0, requiredCount);
      if (selected.length !== requiredCount) {
        throw new WorkflowFragmentError(
          "DLS-FRAGMENT-CONTEXT",
          "validated threshold fragments are unavailable",
          409,
        );
      }

      const plaintextShares: Uint8Array[] = [];
      const stageKeys: Uint8Array[] = [];
      let vaultKey: Uint8Array | undefined;
      let releaseStageKey: Uint8Array | undefined;
      let wrappedNonce: Uint8Array | undefined;
      let wrappedCiphertext: Uint8Array | undefined;
      try {
        for (const row of selected) {
          const stageVersion = positiveInteger(row.stage_key_version, "stage key version");
          const provided = await keyForVersion(dependencies.stageKeys, stageVersion);
          const stageKey = ownedBytes(provided.key, "stage key", 32);
          stageKeys.push(stageKey);
          const share = await dependencies.releaseCryptography.openStage({
            fragment: row,
            stageKey,
          });
          if (!(share instanceof Uint8Array) || share.length === 0) {
            throw new Error("stage fragment plaintext is invalid");
          }
          plaintextShares.push(share);
          if (
            !(await dependencies.releaseCryptography.verifyShare({
              fragment: row,
              share,
              generation,
              vault,
            }))
          ) {
            throw new Error("stage fragment failed threshold re-verification");
          }
        }
        vaultKey = await dependencies.releaseCryptography.reconstruct({
          shares: plaintextShares,
          fragments: selected,
          generation,
          vault,
        });
        const actualCommitment = await dependencies.releaseCryptography.commitVaultKey(vaultKey);
        const expectedCommitment = ownedBytes(vault.vk_commitment, "VK commitment", 32);
        try {
          if (!equalBytes(actualCommitment, expectedCommitment)) {
            throw new Error("reconstructed vault key commitment mismatch");
          }
        } finally {
          actualCommitment.fill(0);
          expectedCommitment.fill(0);
        }
        const releaseStage = await dependencies.stageKeys.currentStageKey("DEATH");
        const releaseStageVersion = positiveInteger(releaseStage.version, "release stage version");
        releaseStageKey = ownedBytes(releaseStage.key, "release stage key", 32);
        const wrapped = await dependencies.releaseCryptography.wrapReleaseVaultKey({
          workflowId,
          vaultId: String(vault.id),
          vaultKey,
          stageKey: releaseStageKey,
          stageKeyVersion: releaseStageVersion,
        });
        wrappedNonce = ownedBytes(wrapped.nonce, "release stage nonce", 24);
        wrappedCiphertext = ownedBytes(
          wrapped.ciphertext,
          "release stage ciphertext",
          undefined,
          33,
        );
        const now = await tx.clock.now();
        const releaseAt = addExactDays(now, 1);
        const sessions = workflowRepository(
          tx.repositories.releaseSecretSessions,
          "release secret sessions",
        );
        const existingSession = await sessions.findOneBy?.("workflow_id", workflowId, {
          forUpdate: true,
        });
        if (existingSession === null || existingSession === undefined) {
          await sessions.insert({
            id: idFactory(),
            workflow_id: workflowId,
            stage_key_envelope: wrappedCiphertext,
            stage_key_nonce: wrappedNonce,
            stage_key_protocol_version: wrapped.protocolVersion,
            stage_key_version: releaseStageVersion,
            status: "ACTIVE",
            created_at: now,
            expires_at: releaseAt,
          });
        }
        await tx.repositories.workflows.updateVersioned(workflowId, Number(workflow.version ?? 0), {
          state: "RELEASE_PENDING",
          approved_count: approvedCount,
          release_at: releaseAt,
        });
        await destroyWorkflowFragments(tx, workflowId);
        for (const offset of REMINDER_OFFSETS_MS) {
          const availableAt = new Date(Date.parse(now) + offset).toISOString();
          await tx.outbox.enqueue({
            eventType: "DEATH_RELEASE_REMINDER_REQUESTED",
            aggregateType: "workflow",
            aggregateId: workflowId,
            payload: {
              aggregateId: workflowId,
              aggregateVersion: Number(workflow.version ?? 0) + 1,
              offsetMs: offset,
            },
            idempotencyKey: `death-release-reminder:${workflowId}:${offset}`,
            availableAt,
          });
        }
        await tx.outbox.enqueue({
          eventType: "WORKFLOW_ADVANCE_REQUESTED",
          aggregateType: "workflow",
          aggregateId: workflowId,
          payload: {
            aggregateId: workflowId,
            aggregateVersion: Number(workflow.version ?? 0) + 1,
          },
          idempotencyKey: `workflow-advance:${workflowId}:${releaseAt}`,
          availableAt: releaseAt,
        });
        await tx.audit.append({
          eventId: idFactory(),
          occurredAt: now,
          eventType: "DEATH_RELEASE_PENDING",
          actorType: "SYSTEM",
          aggregateType: "workflow",
          aggregateId: workflowId,
          result: "SUCCESS",
          metadata: { approvedCount, requiredCount, releaseAt },
        });
        return {
          status: "RELEASE_PENDING",
          approvedCount,
          thresholdReached: true,
          workflowState: "RELEASE_PENDING",
          releaseAt,
        };
      } finally {
        for (const share of plaintextShares) share.fill(0);
        for (const key of stageKeys) key.fill(0);
        vaultKey?.fill(0);
        releaseStageKey?.fill(0);
        wrappedNonce?.fill(0);
        wrappedCiphertext?.fill(0);
      }
    },
    { isolation: "serializable" },
  );
}
