import type { EmailTemplateRendererPort } from "../ports/email-template-renderer.js";
import type { RepositoryRow } from "../ports/repositories.js";
import type { TransactionContext, TransactionManager } from "../ports/transaction-manager.js";

export type EncryptedNotificationValue = Readonly<{
  ciphertext: Uint8Array;
  nonce: Uint8Array;
}>;

export interface NotificationCipher {
  encrypt(value: string, purpose: string): Promise<EncryptedNotificationValue>;
  decrypt(ciphertext: Uint8Array, nonce: Uint8Array, purpose: string): Promise<string>;
}

export type CreateNotificationCommand = Readonly<{
  eventId: string;
  aggregateId: string;
  aggregateType: string;
  templateCode: string;
  templateContext: Readonly<Record<string, unknown>>;
  recipient: Readonly<{
    type: "OWNER_PRIMARY" | "OWNER_BACKUP" | "CONTACT";
    email: string;
    backupEmail?: string;
    ref?: string;
  }>;
  idempotencyKey: string;
}>;

export type CreateNotificationResult = Readonly<{
  notificationId: string;
  status: string;
  templateCode: string;
  templateVersion: number;
}>;

type Dependencies = Readonly<{
  transaction: TransactionManager;
  renderer: EmailTemplateRendererPort;
  cipher: NotificationCipher;
  idFactory?: () => string;
}>;

export type NotificationCreationDependencies = Readonly<{
  renderer: EmailTemplateRendererPort;
  cipher: NotificationCipher;
  idFactory?: () => string;
}>;

function resultFromRow(row: RepositoryRow): CreateNotificationResult {
  return {
    notificationId: String(row.id),
    status: String(row.status),
    templateCode: String(row.template_code),
    templateVersion: Number(row.template_version),
  };
}

function requireNotifications(
  repositories: Parameters<Parameters<TransactionManager["run"]>[0]>[0]["repositories"],
) {
  const repository = repositories.notifications;
  if (repository === undefined) throw new Error("Notifications repository is unavailable");
  return repository;
}

export async function createNotification(
  command: CreateNotificationCommand,
  dependencies: Dependencies,
): Promise<CreateNotificationResult> {
  const notificationId = dependencies.idFactory?.() ?? crypto.randomUUID();
  try {
    return await dependencies.transaction.run((tx) =>
      createNotificationInTransaction(command, tx, {
        renderer: dependencies.renderer,
        cipher: dependencies.cipher,
        idFactory: () => notificationId,
      }),
    );
  } catch (error) {
    const existing = await dependencies.transaction.run(async (tx) =>
      requireNotifications(tx.repositories).findOneBy?.("idempotency_key", command.idempotencyKey),
    );
    if (existing !== null && existing !== undefined) return resultFromRow(existing);
    throw error;
  }
}

export async function createNotificationInTransaction(
  command: CreateNotificationCommand,
  tx: TransactionContext,
  dependencies: NotificationCreationDependencies,
): Promise<CreateNotificationResult> {
  const notifications = requireNotifications(tx.repositories);
  const existing = await notifications.findOneBy?.("idempotency_key", command.idempotencyKey, {
    forUpdate: true,
  });
  if (existing !== null && existing !== undefined) return resultFromRow(existing);

  const rendered = await dependencies.renderer.render(
    command.templateCode,
    command.templateContext,
  );
  if (rendered.templateCode !== command.templateCode) {
    throw new Error("Rendered notification template code does not match the requested template");
  }
  if (!Number.isSafeInteger(rendered.templateVersion) || rendered.templateVersion < 1) {
    throw new Error("Rendered notification template version is invalid");
  }

  const [recipient, backupRecipient, subject, templateData] = await Promise.all([
    dependencies.cipher.encrypt(command.recipient.email, "notification:recipient"),
    command.recipient.backupEmail === undefined
      ? Promise.resolve(undefined)
      : dependencies.cipher.encrypt(command.recipient.backupEmail, "notification:backup-recipient"),
    dependencies.cipher.encrypt(rendered.subject, "notification:subject"),
    dependencies.cipher.encrypt(
      JSON.stringify(command.templateContext),
      "notification:template-data",
    ),
  ]);

  const notificationId = dependencies.idFactory?.() ?? crypto.randomUUID();
  const now = await tx.clock.now();
  const row = await notifications.insert({
    id: notificationId,
    template_code: command.templateCode,
    template_version: rendered.templateVersion,
    recipient_type: command.recipient.type,
    recipient_ref: command.recipient.ref ?? null,
    recipient_email_ciphertext: recipient.ciphertext,
    recipient_email_nonce: recipient.nonce,
    fallback_email_ciphertext: backupRecipient?.ciphertext ?? null,
    fallback_email_nonce: backupRecipient?.nonce ?? null,
    subject_ciphertext: subject.ciphertext,
    subject_nonce: subject.nonce,
    template_data_ciphertext: templateData.ciphertext,
    template_data_nonce: templateData.nonce,
    status: "QUEUED",
    idempotency_key: command.idempotencyKey,
    attempt_count: 0,
    next_attempt_at: now,
    sent_at: null,
    failed_at: null,
    last_error_code: null,
    created_at: now,
    updated_at: now,
    version: 0,
  });
  await tx.outbox.enqueue({
    eventType: "NOTIFICATION_DELIVER_REQUESTED",
    aggregateType: "notification",
    aggregateId: notificationId,
    payload: { aggregateId: notificationId, aggregateVersion: 0 },
    idempotencyKey: `notification-deliver:${notificationId}:0`,
    availableAt: now,
  });
  return resultFromRow(row);
}
