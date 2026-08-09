import type {
  EmailDeliveryOutcome,
  EmailSenderPort,
  EmailSendResult,
} from "../ports/email-sender.js";
import type { EmailTemplateRendererPort, RenderedEmail } from "../ports/email-template-renderer.js";
import type { RepositoryRow, VersionedRepository } from "../ports/repositories.js";
import type { TransactionManager } from "../ports/transaction-manager.js";
import type { NotificationCipher } from "./create-notification.js";
import {
  MAX_NOTIFICATION_ATTEMPTS,
  notificationRetryDelayMs,
  shouldUseBackupRecipient,
} from "./notification-policy.js";

const CLAIM_LEASE_MS = 5 * 60_000;

type DeliveryStatus =
  | "SENT"
  | "ALREADY_SENT"
  | "RETRY_SCHEDULED"
  | "FAILED"
  | "WAITING"
  | "CLOSED"
  | "NOT_FOUND";

export type DeliverNotificationResult = Readonly<{
  status: DeliveryStatus;
  attemptCount?: number;
}>;

type Dependencies = Readonly<{
  transaction: TransactionManager;
  renderer: EmailTemplateRendererPort;
  cipher: NotificationCipher;
  sender: EmailSenderPort;
  messageIdDomain: string;
  idFactory?: () => string;
}>;

type DeliveryAttempt = Readonly<{
  targetKind: "PRIMARY" | "BACKUP" | "CONTACT";
  startedAt: string;
  finishedAt: string;
  result: EmailSendResult;
}>;

type Claimed = Readonly<{
  row: RepositoryRow;
  version: number;
  now: string;
}>;

function repositories(
  row: Readonly<{
    notifications?: VersionedRepository;
    notificationAttempts?: VersionedRepository;
  }>,
) {
  if (row.notifications === undefined || row.notificationAttempts === undefined) {
    throw new Error("Notification repositories are unavailable");
  }
  return { notifications: row.notifications, attempts: row.notificationAttempts };
}

function bytes(value: unknown, column: string): Uint8Array {
  if (value instanceof Uint8Array) return value;
  throw new Error(`Notification column ${column} is invalid`);
}

function validMessageIdDomain(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/u.test(normalized)) {
    throw new Error("Notification message ID domain is invalid");
  }
  return normalized;
}

function messageId(
  notificationId: string,
  domain: string,
  target: DeliveryAttempt["targetKind"],
): string {
  const suffix = target === "BACKUP" ? ".backup" : "";
  return `<${notificationId}${suffix}@${domain}>`;
}

function normalizeErrorCode(result: EmailSendResult): string | null {
  const candidate = result.errorCode?.trim().toUpperCase();
  if (candidate !== undefined && /^[A-Z][A-Z0-9_]{0,63}$/u.test(candidate)) return candidate;
  if (result.outcome === "TEMP_FAIL") return "SMTP_TEMP_FAILURE";
  if (result.outcome === "PERM_FAIL") return "SMTP_PERM_FAILURE";
  return null;
}

function normalizeSendResult(value: EmailSendResult): EmailSendResult {
  const smtpStatusClass =
    Number.isInteger(value.smtpStatusClass) &&
    Number(value.smtpStatusClass) >= 2 &&
    Number(value.smtpStatusClass) <= 5
      ? Number(value.smtpStatusClass)
      : undefined;
  const providerMessageId =
    typeof value.providerMessageId === "string" && value.providerMessageId.length <= 998
      ? value.providerMessageId
      : undefined;
  const errorCode = normalizeErrorCode(value);
  return {
    outcome: value.outcome,
    ...(smtpStatusClass === undefined ? {} : { smtpStatusClass }),
    ...(providerMessageId === undefined ? {} : { providerMessageId }),
    ...(errorCode === null ? {} : { errorCode }),
  };
}

async function sendSafely(
  sender: EmailSenderPort,
  message: Parameters<EmailSenderPort["send"]>[0],
): Promise<EmailSendResult> {
  try {
    return normalizeSendResult(await sender.send(message));
  } catch {
    return { outcome: "TEMP_FAIL", errorCode: "SMTP_TIMEOUT" };
  }
}

function attemptTarget(recipientType: unknown): DeliveryAttempt["targetKind"] {
  if (recipientType === "CONTACT") return "CONTACT";
  if (recipientType === "OWNER_BACKUP") return "BACKUP";
  return "PRIMARY";
}

async function renderSnapshot(
  row: RepositoryRow,
  dependencies: Dependencies,
): Promise<Readonly<{ rendered: RenderedEmail; recipient: string; backupRecipient?: string }>> {
  const [recipient, backupRecipient, subject, templateData] = await Promise.all([
    dependencies.cipher.decrypt(
      bytes(row.recipient_email_ciphertext, "recipient_email_ciphertext"),
      bytes(row.recipient_email_nonce, "recipient_email_nonce"),
      "notification:recipient",
    ),
    row.fallback_email_ciphertext === null || row.fallback_email_ciphertext === undefined
      ? Promise.resolve(undefined)
      : dependencies.cipher.decrypt(
          bytes(row.fallback_email_ciphertext, "fallback_email_ciphertext"),
          bytes(row.fallback_email_nonce, "fallback_email_nonce"),
          "notification:backup-recipient",
        ),
    dependencies.cipher.decrypt(
      bytes(row.subject_ciphertext, "subject_ciphertext"),
      bytes(row.subject_nonce, "subject_nonce"),
      "notification:subject",
    ),
    dependencies.cipher.decrypt(
      bytes(row.template_data_ciphertext, "template_data_ciphertext"),
      bytes(row.template_data_nonce, "template_data_nonce"),
      "notification:template-data",
    ),
  ]);
  const parsed = JSON.parse(templateData) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Notification template snapshot is invalid");
  }
  const rendered = await dependencies.renderer.render(
    String(row.template_code),
    parsed as Readonly<Record<string, unknown>>,
  );
  if (
    rendered.templateCode !== String(row.template_code) ||
    rendered.templateVersion !== Number(row.template_version) ||
    rendered.subject !== subject
  ) {
    throw new Error("Notification template snapshot version is unavailable");
  }
  return { rendered, recipient, ...(backupRecipient === undefined ? {} : { backupRecipient }) };
}

function finalOutcome(attempts: readonly DeliveryAttempt[]): EmailDeliveryOutcome {
  return attempts.at(-1)?.result.outcome ?? "TEMP_FAIL";
}

export async function deliverNotification(
  command: Readonly<{ notificationId: string }>,
  dependencies: Dependencies,
): Promise<DeliverNotificationResult> {
  const domain = validMessageIdDomain(dependencies.messageIdDomain);
  const claim = await dependencies.transaction.run<Claimed | DeliverNotificationResult>(
    async (tx) => {
      const { notifications } = repositories(tx.repositories);
      const row = await notifications.findById(command.notificationId, { forUpdate: true });
      if (row === null) return { status: "NOT_FOUND" };
      if (row.status === "SENT")
        return { status: "ALREADY_SENT", attemptCount: Number(row.attempt_count) };
      if (["FAILED", "CANCELLED"].includes(String(row.status))) {
        return { status: "CLOSED", attemptCount: Number(row.attempt_count) };
      }
      const now = await tx.clock.now();
      if (
        (row.status === "RETRY_WAIT" || row.status === "SENDING") &&
        typeof row.next_attempt_at === "string" &&
        Date.parse(now) < Date.parse(row.next_attempt_at)
      ) {
        return { status: "WAITING", attemptCount: Number(row.attempt_count) };
      }
      const version = Number(row.version);
      const claimedRow = await notifications.updateVersioned(command.notificationId, version, {
        status: "SENDING",
        next_attempt_at: new Date(Date.parse(now) + CLAIM_LEASE_MS).toISOString(),
        last_error_code: null,
      });
      return { row: claimedRow, version: Number(claimedRow.version), now };
    },
  );
  if (!("row" in claim)) return claim;

  const attempts: DeliveryAttempt[] = [];
  let snapshot: Awaited<ReturnType<typeof renderSnapshot>> | undefined;
  try {
    snapshot = await renderSnapshot(claim.row, dependencies);
  } catch {
    const now = await dependencies.transaction.run((tx) => tx.clock.now());
    attempts.push({
      targetKind: attemptTarget(claim.row.recipient_type),
      startedAt: claim.now,
      finishedAt: now,
      result: { outcome: "PERM_FAIL", errorCode: "TEMPLATE_SNAPSHOT_INVALID" },
    });
  }

  if (snapshot !== undefined) {
    const primaryTarget = attemptTarget(claim.row.recipient_type);
    const primaryStartedAt = await dependencies.transaction.run((tx) => tx.clock.now());
    const primaryResult = await sendSafely(dependencies.sender, {
      to: snapshot.recipient,
      subject: snapshot.rendered.subject,
      html: snapshot.rendered.html,
      text: snapshot.rendered.text,
      messageId: messageId(command.notificationId, domain, primaryTarget),
    });
    const primaryFinishedAt = await dependencies.transaction.run((tx) => tx.clock.now());
    attempts.push({
      targetKind: primaryTarget,
      startedAt: primaryStartedAt,
      finishedAt: primaryFinishedAt,
      result: primaryResult,
    });

    if (
      shouldUseBackupRecipient({
        templateCode: String(claim.row.template_code),
        recipientType: String(claim.row.recipient_type),
        primaryOutcome: primaryResult.outcome,
        hasBackupRecipient: snapshot.backupRecipient !== undefined,
      }) &&
      snapshot.backupRecipient !== undefined
    ) {
      const backupStartedAt = await dependencies.transaction.run((tx) => tx.clock.now());
      const backupResult = await sendSafely(dependencies.sender, {
        to: snapshot.backupRecipient,
        subject: snapshot.rendered.subject,
        html: snapshot.rendered.html,
        text: snapshot.rendered.text,
        messageId: messageId(command.notificationId, domain, "BACKUP"),
      });
      const backupFinishedAt = await dependencies.transaction.run((tx) => tx.clock.now());
      attempts.push({
        targetKind: "BACKUP",
        startedAt: backupStartedAt,
        finishedAt: backupFinishedAt,
        result: backupResult,
      });
    }
  }

  return dependencies.transaction.run(async (tx) => {
    const { notifications, attempts: attemptRepository } = repositories(tx.repositories);
    const current = await notifications.findById(command.notificationId, { forUpdate: true });
    if (current === null) return { status: "NOT_FOUND" };
    if (current.status === "SENT")
      return { status: "ALREADY_SENT", attemptCount: Number(current.attempt_count) };
    if (current.status !== "SENDING" || Number(current.version) !== claim.version) {
      return { status: "WAITING", attemptCount: Number(current.attempt_count) };
    }

    const attemptNo = Number(current.attempt_count) + 1;
    for (const attempt of attempts) {
      const providerMessageId =
        attempt.result.providerMessageId === undefined
          ? undefined
          : await dependencies.cipher.encrypt(
              attempt.result.providerMessageId,
              "notification:provider-message-id",
            );
      await attemptRepository.insert({
        id: dependencies.idFactory?.() ?? crypto.randomUUID(),
        notification_id: command.notificationId,
        attempt_no: attemptNo,
        target_kind: attempt.targetKind,
        started_at: attempt.startedAt,
        finished_at: attempt.finishedAt,
        result: attempt.result.outcome,
        smtp_status_class: attempt.result.smtpStatusClass ?? null,
        provider_message_id_ciphertext: providerMessageId?.ciphertext ?? null,
        provider_message_id_nonce: providerMessageId?.nonce ?? null,
        error_code: normalizeErrorCode(attempt.result),
      });
    }

    const now = await tx.clock.now();
    const outcome = finalOutcome(attempts);
    if (outcome === "ACCEPTED") {
      await notifications.updateVersioned(command.notificationId, claim.version, {
        status: "SENT",
        attempt_count: attemptNo,
        next_attempt_at: now,
        sent_at: now,
        failed_at: null,
        last_error_code: null,
      });
      return { status: "SENT", attemptCount: attemptNo };
    }

    const errorCode = normalizeErrorCode(attempts.at(-1)?.result ?? { outcome: "TEMP_FAIL" });
    if (outcome === "TEMP_FAIL" && attemptNo < MAX_NOTIFICATION_ATTEMPTS) {
      const nextAttemptAt = new Date(
        Date.parse(now) + notificationRetryDelayMs(attemptNo),
      ).toISOString();
      await notifications.updateVersioned(command.notificationId, claim.version, {
        status: "RETRY_WAIT",
        attempt_count: attemptNo,
        next_attempt_at: nextAttemptAt,
        last_error_code: errorCode,
      });
      await tx.outbox.enqueue({
        eventType: "NOTIFICATION_DELIVER_REQUESTED",
        aggregateType: "notification",
        aggregateId: command.notificationId,
        payload: { aggregateId: command.notificationId, aggregateVersion: claim.version + 1 },
        idempotencyKey: `notification-deliver:${command.notificationId}:${attemptNo}`,
        availableAt: nextAttemptAt,
      });
      return { status: "RETRY_SCHEDULED", attemptCount: attemptNo };
    }

    await notifications.updateVersioned(command.notificationId, claim.version, {
      status: "FAILED",
      attempt_count: attemptNo,
      next_attempt_at: now,
      failed_at: now,
      last_error_code: errorCode,
    });
    return { status: "FAILED", attemptCount: attemptNo };
  });
}
