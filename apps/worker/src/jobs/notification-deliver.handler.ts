import {
  deliverNotification,
  type EmailSenderPort,
  type EmailTemplateRendererPort,
  type NotificationCipher,
  type TransactionManager,
} from "@dls/application";
import { createPgPool, PgTransactionManager } from "@dls/persistence";
import { loadWorkerConfig } from "../config/load-config.js";
import { AesNotificationCipher } from "../notifications/aes-notification-cipher.js";
import { createNodemailerEmailSender } from "../notifications/nodemailer-email-sender.js";
import { StrictEmailTemplateRenderer } from "../notifications/strict-email-template-renderer.js";
import type { WorkerJob } from "./register-handlers.js";

export class NotificationDeliverHandler {
  public constructor(
    private readonly transaction: TransactionManager,
    private readonly renderer: EmailTemplateRendererPort,
    private readonly cipher: NotificationCipher,
    private readonly sender: EmailSenderPort,
    private readonly messageIdDomain: string,
  ) {}

  public async handle(job: WorkerJob): Promise<void> {
    await deliverNotification(
      { notificationId: job.data.aggregateId },
      {
        transaction: this.transaction,
        renderer: this.renderer,
        cipher: this.cipher,
        sender: this.sender,
        messageIdDomain: this.messageIdDomain,
      },
    );
  }
}

export function createNotificationDeliverHandler(): NotificationDeliverHandler {
  const config = loadWorkerConfig();
  const pool = createPgPool({ connectionString: config.databaseUrl });
  return new NotificationDeliverHandler(
    new PgTransactionManager(pool),
    new StrictEmailTemplateRenderer(),
    new AesNotificationCipher(config.security.sessionSecret),
    createNodemailerEmailSender({
      transportUrl: config.mail.transportUrl,
      from: config.mail.from,
      nodeEnv: config.nodeEnv,
    }),
    config.publicBaseUrl.hostname,
  );
}
