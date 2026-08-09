import { addExactDays } from "@dls/domain";
import type { TransactionManager } from "../ports/transaction-manager.js";
import { activeRecovery, digestSecret, makeSecret } from "./recovery-common.js";

export type RequestRecoveryResult = Readonly<{
  accepted: true;
  message: string;
}>;

const GENERIC_RESPONSE: RequestRecoveryResult = Object.freeze({
  accepted: true,
  message: "如果系统已完成配置，启动邮件将被发送",
});

export async function requestRecovery(
  command: Readonly<{ requestId: string }>,
  dependencies: Readonly<{
    transaction: TransactionManager;
    tokenPepper: Uint8Array;
    tokenFactory?: () => Uint8Array;
    onPrimaryStartToken?: (token: string) => Promise<void>;
    idFactory?: () => string;
  }>,
): Promise<RequestRecoveryResult> {
  let issuedToken: string | undefined;
  await dependencies.transaction.run(async (tx) => {
    const owner = await tx.repositories.ownerProfile.findById(true, { forUpdate: true });
    if (owner === null || owner.setup_state === "INCOMPLETE") return;
    const workflows = (await tx.repositories.workflows.findMany?.()) ?? [];
    if (
      activeRecovery(workflows) !== undefined ||
      workflows.some(
        (row) =>
          row.kind === "DEATH_CONFIRMATION" &&
          !["CANCELLED", "RELEASED", "EXPIRED", "COMPLETED"].includes(String(row.state)),
      )
    ) {
      return;
    }
    const now = await tx.clock.now();
    const expiresAt = addExactDays(now, 1);
    issuedToken = makeSecret(dependencies.tokenFactory);
    const tokenId = dependencies.idFactory?.() ?? crypto.randomUUID();
    await tx.repositories.oneTimeTokens?.insert({
      id: tokenId,
      purpose: "ADMIN_RECOVERY_START",
      subject_type: "OWNER",
      subject_id: null,
      token_hash: digestSecret(issuedToken, dependencies.tokenPepper),
      token_hmac_key_version: 1,
      expires_at: expiresAt,
      consumed_at: null,
      revoked_at: null,
      created_at: now,
    });
    await tx.outbox.enqueue({
      eventType: "PASSWORD_RECOVERY_START_REQUESTED",
      aggregateType: "owner",
      aggregateId: "00000000-0000-0000-0000-000000000001",
      payload: { recipientType: "OWNER_PRIMARY", tokenId, expiresAt },
      idempotencyKey: `password-recovery-start:${tokenId}`,
      availableAt: now,
    });
    await tx.audit.append({
      eventId: crypto.randomUUID(),
      occurredAt: now,
      eventType: "PASSWORD_RECOVERY_REQUESTED",
      actorType: "ANONYMOUS",
      aggregateType: "owner",
      aggregateId: "00000000-0000-0000-0000-000000000001",
      requestId: command.requestId,
      result: "SUCCESS",
      metadata: {},
    });
  });
  if (issuedToken !== undefined) await dependencies.onPrimaryStartToken?.(issuedToken);
  return GENERIC_RESPONSE;
}
