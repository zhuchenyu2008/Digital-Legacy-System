import { parseInstant } from "@dls/domain";
import type { RepositoryRow } from "../ports/repositories.js";
import type { StageKeyProvider, VersionedStageKey } from "../ports/stage-key-provider.js";
import type { TransactionManager } from "../ports/transaction-manager.js";
import { workflowRepository } from "./contact-decision-common.js";

export class ReleaseAdvanceCriticalError extends Error {
  public readonly code = "DLS-RELEASE-STAGE-KEY";
  public readonly severity = "CRITICAL";
  public readonly retryable = true;

  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ReleaseAdvanceCriticalError";
  }
}

export type AdvanceReleaseResult =
  | Readonly<{ status: "STALE" | "CLOSED" }>
  | Readonly<{ status: "WAITING"; releaseAt: string }>
  | Readonly<{
      status: "LOCKED" | "ALREADY_LOCKED";
      publishLockedAt: string;
      workflowVersion: number;
    }>;

async function exactStageKey(
  provider: StageKeyProvider,
  session: RepositoryRow,
): Promise<VersionedStageKey> {
  const version = Number(session.stage_key_version);
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new ReleaseAdvanceCriticalError("release stage key version is invalid");
  }
  let provided: VersionedStageKey;
  try {
    provided =
      provider.stageKey === undefined
        ? await provider.currentStageKey("DEATH")
        : await provider.stageKey("DEATH", version);
  } catch (error) {
    throw new ReleaseAdvanceCriticalError("release stage key is unavailable", { cause: error });
  }
  if (!(provided.key instanceof Uint8Array) || provided.key.length !== 32) {
    provided.key?.fill(0);
    throw new ReleaseAdvanceCriticalError("release stage key material is invalid");
  }
  if (provided.version !== version) {
    provided.key.fill(0);
    throw new ReleaseAdvanceCriticalError("release stage key version does not match the session");
  }
  return provided;
}

function alreadyLocked(workflow: RepositoryRow): AdvanceReleaseResult {
  if (typeof workflow.publish_locked_at !== "string") return { status: "CLOSED" };
  return {
    status: "ALREADY_LOCKED",
    publishLockedAt: parseInstant(workflow.publish_locked_at),
    workflowVersion: Number(workflow.version ?? 0),
  };
}

export async function advanceRelease(
  command: Readonly<{ workflowId: string; aggregateVersion: number }>,
  dependencies: Readonly<{
    transaction: TransactionManager;
    stageKeys: StageKeyProvider;
    beforePublishLock?: () => Promise<void>;
    afterPublishLock?: () => Promise<void>;
    idFactory?: () => string;
  }>,
): Promise<AdvanceReleaseResult> {
  return dependencies.transaction.run(async (tx) => {
    const workflow = await tx.repositories.workflows.findById(command.workflowId, {
      forUpdate: true,
    });
    if (workflow === null || workflow.kind !== "DEATH_CONFIRMATION") return { status: "STALE" };
    if (workflow.publish_locked_at !== null && workflow.publish_locked_at !== undefined) {
      return alreadyLocked(workflow);
    }
    if (workflow.state !== "RELEASE_PENDING") return { status: "CLOSED" };
    if (Number(workflow.version ?? 0) !== command.aggregateVersion) return { status: "STALE" };

    const now = await tx.clock.now();
    if (typeof workflow.release_at !== "string") {
      throw new ReleaseAdvanceCriticalError("release deadline is unavailable");
    }
    const releaseAt = parseInstant(workflow.release_at);
    if (Date.parse(now) < Date.parse(releaseAt)) return { status: "WAITING", releaseAt };

    const sessions = workflowRepository(
      tx.repositories.releaseSecretSessions,
      "release secret sessions",
    );
    const session = await sessions.findOneBy?.("workflow_id", command.workflowId, {
      forUpdate: true,
    });
    if (
      session === null ||
      session === undefined ||
      session.status !== "ACTIVE" ||
      !(session.stage_key_envelope instanceof Uint8Array) ||
      !(session.stage_key_nonce instanceof Uint8Array)
    ) {
      throw new ReleaseAdvanceCriticalError("active release secret session is unavailable");
    }
    const stageKey = await exactStageKey(dependencies.stageKeys, session);
    try {
      await dependencies.beforePublishLock?.();
      const locked = await tx.repositories.workflows.updateVersioned(
        command.workflowId,
        command.aggregateVersion,
        { publish_locked_at: now },
      );
      await dependencies.afterPublishLock?.();
      const nextVersion = Number(locked.version ?? command.aggregateVersion + 1);
      await tx.outbox.enqueue({
        eventType: "PUBLICATION_FINALIZE_REQUESTED",
        aggregateType: "workflow",
        aggregateId: command.workflowId,
        payload: { aggregateId: command.workflowId, aggregateVersion: nextVersion },
        idempotencyKey: `publication-finalize:${command.workflowId}:${nextVersion}`,
        availableAt: now,
      });
      await tx.audit.append({
        eventId: dependencies.idFactory?.() ?? crypto.randomUUID(),
        occurredAt: now,
        eventType: "RELEASE_PUBLISH_LOCKED",
        actorType: "SYSTEM",
        aggregateType: "workflow",
        aggregateId: command.workflowId,
        result: "SUCCESS",
        metadata: { releaseAt },
      });
      return {
        status: "LOCKED",
        publishLockedAt: parseInstant(now),
        workflowVersion: nextVersion,
      };
    } finally {
      stageKey.key.fill(0);
    }
  });
}
