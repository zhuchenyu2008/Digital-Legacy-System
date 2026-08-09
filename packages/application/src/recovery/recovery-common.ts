import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { parseInstant } from "@dls/domain";
import type { RepositoryRow, VersionedRepository } from "../ports/repositories.js";
import type { TransactionContext } from "../ports/transaction-manager.js";

export class RecoveryError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly status = 409,
  ) {
    super(message);
    this.name = "RecoveryError";
  }
}

export function recoveryRepository(
  value: VersionedRepository | undefined,
  name: string,
): VersionedRepository {
  if (value === undefined) {
    throw new RecoveryError("DLS-RECOVERY-UNAVAILABLE", `${name} is unavailable`, 503);
  }
  return value;
}

export function recoveryBytes(
  value: unknown,
  name: string,
  exact?: number,
  minimum = 1,
): Uint8Array {
  if (
    !(value instanceof Uint8Array) ||
    value.length < minimum ||
    (exact !== undefined && value.length !== exact)
  ) {
    throw new RecoveryError("DLS-RECOVERY-INVALID", `${name} is invalid`, 422);
  }
  return new Uint8Array(value);
}

export function recoveryInteger(value: unknown, name: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new RecoveryError("DLS-RECOVERY-INVALID", `${name} is invalid`, 422);
  }
  return parsed;
}

export function recoverySha256(value: string | Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(value).digest());
}

export function digestSecret(value: string, pepper: Uint8Array): Uint8Array {
  if (!(pepper instanceof Uint8Array) || pepper.length < 16) {
    throw new RecoveryError("DLS-RECOVERY-UNAVAILABLE", "token key is unavailable", 503);
  }
  return new Uint8Array(createHmac("sha256", pepper).update(value, "utf8").digest());
}

export function makeSecret(factory?: () => Uint8Array): string {
  const material = factory?.() ?? randomBytes(32);
  if (!(material instanceof Uint8Array) || material.length !== 32) {
    throw new RecoveryError("DLS-RECOVERY-UNAVAILABLE", "token generator failed", 500);
  }
  const owned = new Uint8Array(material);
  try {
    return Buffer.from(owned).toString("base64url");
  } finally {
    owned.fill(0);
  }
}

export function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

export function addMinutes(instant: string, minutes: number): string {
  return parseInstant(new Date(Date.parse(instant) + minutes * 60_000).toISOString());
}

export async function destroyRecoveryArtifacts(
  tx: TransactionContext,
  workflowId: string,
  now: string,
): Promise<void> {
  const fragments = recoveryRepository(tx.repositories.workflowKeyFragments, "workflow fragments");
  for (const fragment of (await fragments.findMany?.("workflow_id", workflowId, {
    forUpdate: true,
  })) ?? []) {
    if (fragment.status === "DESTROYED") continue;
    await fragments.updateVersioned(fragment.id, Number(fragment.version ?? 0), {
      status: "DESTROYED",
      fragment_ciphertext: null,
      fragment_nonce: null,
      stage_key_version: null,
    });
  }

  const recoverySessions = recoveryRepository(
    tx.repositories.recoverySecretSessions,
    "recovery secret sessions",
  );
  const recoverySession = await recoverySessions.findOneBy?.("workflow_id", workflowId, {
    forUpdate: true,
  });
  if (
    recoverySession !== null &&
    recoverySession !== undefined &&
    recoverySession.status !== "DESTROYED"
  ) {
    await recoverySessions.updateVersioned(
      recoverySession.id,
      Number(recoverySession.version ?? 0),
      {
        status: "DESTROYED",
        stage_key_envelope: null,
        stage_key_nonce: null,
        consumed_at: now,
      },
    );
  }

  const rewraps = recoveryRepository(
    tx.repositories.passwordRewrapSessions,
    "password rewrap sessions",
  );
  const rewrap = await rewraps.findOneBy?.("workflow_id", workflowId, { forUpdate: true });
  if (rewrap !== null && rewrap !== undefined && rewrap.status === "ACTIVE") {
    await rewraps.updateVersioned(rewrap.id, Number(rewrap.version ?? 0), {
      status: "DESTROYED",
      completed_at: now,
    });
  }

  const tokens = tx.repositories.oneTimeTokens;
  for (const token of (await tokens?.findMany?.("subject_id", workflowId, { forUpdate: true })) ??
    []) {
    if (
      token.consumed_at === null &&
      token.revoked_at === null &&
      tokens?.updateById !== undefined
    ) {
      await tokens.updateById(token.id, { revoked_at: now });
    }
  }

  const codes = recoveryRepository(
    tx.repositories.emailVerificationCodes,
    "email verification codes",
  );
  for (const code of (await codes.findMany?.("workflow_id", workflowId, { forUpdate: true })) ??
    []) {
    if (code.consumed_at === null && code.locked_at === null) {
      await codes.updateVersioned(code.id, Number(code.version ?? 0), { locked_at: now });
    }
  }
}

export function activeRecovery(rows: readonly RepositoryRow[]): RepositoryRow | undefined {
  return rows.find(
    (row) =>
      row.kind === "PASSWORD_RECOVERY" &&
      !["COMPLETED", "CANCELLED", "EXPIRED"].includes(String(row.state)),
  );
}

export async function cancelActiveRecovery(
  tx: TransactionContext,
  now: string,
  reason: "OWNER_AUTHENTICATED" | "DEATH_WORKFLOW_PRIORITY",
): Promise<Readonly<{ cancelled: boolean; previousState: string | null }>> {
  const rows =
    (await tx.repositories.workflows.findMany?.(undefined, undefined, {
      forUpdate: true,
    })) ?? [];
  const workflow = activeRecovery(rows);
  if (workflow === undefined) return { cancelled: false, previousState: null };
  const previousState = String(workflow.state);
  await destroyRecoveryArtifacts(tx, String(workflow.id), now);
  await tx.repositories.workflows.updateVersioned(workflow.id, Number(workflow.version ?? 0), {
    state: "CANCELLED",
    ended_at: now,
    end_reason: reason,
  });
  await tx.outbox.enqueue({
    eventType: "PASSWORD_RECOVERY_CANCELLED",
    aggregateType: "workflow",
    aggregateId: String(workflow.id),
    payload: {
      aggregateId: String(workflow.id),
      aggregateVersion: Number(workflow.version ?? 0) + 1,
      reason,
    },
    idempotencyKey: `password-recovery-cancelled:${String(workflow.id)}:${reason}`,
    availableAt: now,
  });
  return { cancelled: true, previousState };
}
