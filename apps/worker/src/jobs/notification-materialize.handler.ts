import {
  createNotificationInTransaction,
  type EmailTemplateRendererPort,
  type NotificationCipher,
  type RepositoryRow,
  type TransactionContext,
  type TransactionManager,
} from "@dls/application";
import { AesFieldProtector } from "@dls/crypto/node";
import { createPgPool, PgTransactionManager } from "@dls/persistence";
import { loadWorkerConfig } from "../config/load-config.js";
import { AesNotificationCipher } from "../notifications/aes-notification-cipher.js";
import { StrictEmailTemplateRenderer } from "../notifications/strict-email-template-renderer.js";
import type { WorkerJob } from "./register-handlers.js";

type MaterializeEvent =
  | "DEATH_CONFIRMATION_INVITATION_REQUESTED"
  | "CHECKIN_REMINDER_24H_REQUESTED"
  | "CHECKIN_REMINDER_12H_REQUESTED"
  | "CHECKIN_REMINDER_5H_REQUESTED"
  | "CHECKIN_REMINDER_1H_REQUESTED"
  | "DEATH_RELEASE_REMINDER_REQUESTED"
  | "DEATH_CANCELLED_BY_CONTACT"
  | "DEATH_CANCELLED_BY_OWNER"
  | "PUBLICATION_RELEASED_NOTIFICATION_REQUESTED";

function bytes(value: unknown, name: string): Uint8Array {
  if (!(value instanceof Uint8Array) || value.length === 0) throw new Error(`${name} is invalid`);
  return new Uint8Array(value);
}

function text(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${name} is invalid`);
  return value;
}

function snapshot(row: RepositoryRow, prefix: "display_name" | "email") {
  return {
    ciphertext: bytes(row[`${prefix}_snapshot_ciphertext`], `${prefix} snapshot ciphertext`),
    nonce: bytes(row[`${prefix}_snapshot_nonce`], `${prefix} snapshot nonce`),
    keyVersion: Number(row[`${prefix}_snapshot_key_version`]),
  };
}

function ownerField(row: RepositoryRow, prefix: "display_name" | "primary_email" | "backup_email") {
  return {
    ciphertext: bytes(row[`${prefix}_ciphertext`], `${prefix} ciphertext`),
    nonce: bytes(row[`${prefix}_nonce`], `${prefix} nonce`),
    keyVersion: Number(row[`${prefix}_key_version`]),
  };
}

function remaining(offsetMs: number): string {
  if (offsetMs >= 24 * 60 * 60_000) return "24 小时";
  if (offsetMs >= 12 * 60 * 60_000) return "12 小时";
  if (offsetMs >= 5 * 60 * 60_000) return "5 小时";
  if (offsetMs >= 60 * 60_000) return "1 小时";
  if (offsetMs === 0) return "现在";
  const hours = Math.max(1, Math.ceil(offsetMs / 60 / 60_000));
  return `${hours} 小时`;
}

function releaseRemaining(offsetMs: number): string {
  return remaining(Math.max(0, 24 * 60 * 60_000 - offsetMs));
}

export class NotificationMaterializeHandler {
  public constructor(
    private readonly transaction: TransactionManager,
    private readonly fieldProtector: Pick<AesFieldProtector, "unprotect">,
    private readonly cipher: NotificationCipher,
    private readonly renderer: EmailTemplateRendererPort,
    private readonly publicBaseUrl: string | URL,
  ) {}

  public async handle(job: WorkerJob): Promise<void> {
    const eventId = job.data.eventId;
    const eventType = job.data.eventType as MaterializeEvent | undefined;
    if (eventId === undefined || eventType === undefined) {
      throw new Error("notification materialization identity is missing");
    }
    await this.transaction.run(async (tx) => {
      const now = await tx.clock.now();
      switch (eventType) {
        case "DEATH_CONFIRMATION_INVITATION_REQUESTED":
          await this.#materializeDeathInvitation(
            tx,
            eventId,
            job.data.aggregateId,
            job.data.contactId,
          );
          return;
        case "CHECKIN_REMINDER_24H_REQUESTED":
        case "CHECKIN_REMINDER_12H_REQUESTED":
        case "CHECKIN_REMINDER_5H_REQUESTED":
        case "CHECKIN_REMINDER_1H_REQUESTED":
          await this.#materializeCheckinReminder(
            tx,
            eventId,
            job.data.aggregateId,
            job.data.aggregateVersion,
            job.data.offsetMs,
          );
          return;
        case "DEATH_RELEASE_REMINDER_REQUESTED":
          await this.#materializeReleaseReminder(
            tx,
            eventId,
            job.data.aggregateId,
            job.data.offsetMs,
          );
          return;
        case "DEATH_CANCELLED_BY_CONTACT":
          await this.#materializeCancelledByContact(
            tx,
            eventId,
            job.data.aggregateId,
            job.data.contactId,
            now,
          );
          return;
        case "DEATH_CANCELLED_BY_OWNER":
          await this.#materializeCancelledByOwner(tx, eventId, job.data.aggregateId, now);
          return;
        case "PUBLICATION_RELEASED_NOTIFICATION_REQUESTED":
          await this.#materializePublicationReleased(
            tx,
            eventId,
            job.data.aggregateId,
            job.data.contactId,
          );
          return;
      }
    });
  }

  async #owner(tx: TransactionContext) {
    const owner = await tx.repositories.ownerProfile.findById(true, { forUpdate: true });
    if (owner === null) throw new Error("owner profile is unavailable");
    const ownerName = await this.fieldProtector.unprotect(
      ownerField(owner, "display_name"),
      "owner-display-name",
    );
    const primaryEmail = await this.fieldProtector.unprotect(
      ownerField(owner, "primary_email"),
      "owner-primary-email",
    );
    const backupEmail =
      owner.backup_email_ciphertext === null || owner.backup_email_ciphertext === undefined
        ? undefined
        : await this.fieldProtector.unprotect(
            ownerField(owner, "backup_email"),
            "owner-backup-email",
          );
    return { owner, ownerName, primaryEmail, backupEmail };
  }

  async #contactSnapshot(tx: TransactionContext, workflowId: string, contactId: string) {
    const snapshots = tx.repositories.workflowContacts;
    if (snapshots === undefined || snapshots.findMany === undefined) {
      throw new Error("workflow contacts repository is unavailable");
    }
    const roster = await snapshots.findMany("workflow_id", workflowId, { forUpdate: true });
    const contact = roster.find((candidate) => String(candidate.contact_id) === contactId);
    if (contact === undefined) throw new Error("workflow contact snapshot is unavailable");
    const name = await this.fieldProtector.unprotect(
      snapshot(contact, "display_name"),
      "contact-display-name",
    );
    const email = await this.fieldProtector.unprotect(snapshot(contact, "email"), "contact-email");
    return { row: contact, name, email };
  }

  async #create(
    tx: TransactionContext,
    eventId: string,
    input: Readonly<{
      aggregateId: string;
      templateCode: string;
      templateContext: Readonly<Record<string, unknown>>;
      recipient: Readonly<{
        type: "OWNER_PRIMARY" | "CONTACT";
        email: string;
        backupEmail?: string;
        ref?: string;
      }>;
      suffix: string;
    }>,
  ) {
    await createNotificationInTransaction(
      {
        eventId,
        aggregateId: input.aggregateId,
        aggregateType: input.recipient.type === "CONTACT" ? "contact" : "workflow",
        templateCode: input.templateCode,
        templateContext: input.templateContext,
        recipient: input.recipient,
        idempotencyKey: `notification-materialize:${eventId}:${input.suffix}`,
      },
      tx,
      { cipher: this.cipher, renderer: this.renderer },
    );
  }

  async #workflowContacts(
    tx: TransactionContext,
    workflowId: string,
  ): Promise<readonly RepositoryRow[]> {
    const repo = tx.repositories.workflowContacts;
    if (repo === undefined || repo.findMany === undefined)
      throw new Error("workflow contacts repository is unavailable");
    return repo.findMany("workflow_id", workflowId, { forUpdate: true });
  }

  async #materializeContactFanout(
    tx: TransactionContext,
    workflowId: string,
    build: (contact: Readonly<{ id: string; name: string; email: string }>) => Promise<void>,
  ) {
    for (const row of await this.#workflowContacts(tx, workflowId)) {
      const id = String(row.contact_id);
      const name = await this.fieldProtector.unprotect(
        snapshot(row, "display_name"),
        "contact-display-name",
      );
      const email = await this.fieldProtector.unprotect(snapshot(row, "email"), "contact-email");
      await build({ id, name, email });
    }
  }

  async #materializeDeathInvitation(
    tx: TransactionContext,
    eventId: string,
    workflowId: string,
    contactId?: string,
  ) {
    const workflow = await tx.repositories.workflows.findById(workflowId, { forUpdate: true });
    if (
      workflow === null ||
      !["AWAITING_CONFIRMATIONS", "GRACE_PERIOD"].includes(String(workflow.state))
    )
      return;
    const ownerName = await this.fieldProtector.unprotect(
      {
        ciphertext: bytes(
          workflow.owner_display_name_snapshot_ciphertext,
          "owner snapshot ciphertext",
        ),
        nonce: bytes(workflow.owner_display_name_snapshot_nonce, "owner snapshot nonce"),
        keyVersion: Number(workflow.owner_display_name_snapshot_key_version),
      },
      "owner-display-name",
    );
    const ids =
      contactId === undefined
        ? (await this.#workflowContacts(tx, workflowId)).map((row) => String(row.contact_id))
        : [contactId];
    for (const id of ids) {
      const contact = await this.#contactSnapshot(tx, workflowId, id);
      const actionUrl = new URL(`/contact/workflows/${workflowId}`, this.publicBaseUrl).href;
      await this.#create(tx, eventId, {
        aggregateId: workflowId,
        templateCode: "DEATH_CONFIRMATION_REQUEST",
        templateContext: { owner_name: ownerName, action_url: actionUrl },
        recipient: { type: "CONTACT", email: contact.email, ref: id },
        suffix: `contact:${id}`,
      });
    }
  }

  async #materializeCheckinReminder(
    tx: TransactionContext,
    eventId: string,
    scheduleId: string,
    aggregateVersion: number,
    offsetMs?: number,
  ) {
    const schedule = await tx.repositories.checkinSchedules.findById(scheduleId, {
      forUpdate: true,
    });
    if (schedule === null) throw new Error("check-in schedule is unavailable");
    if (Number(schedule.schedule_version) !== aggregateVersion) return;
    const owner = await this.#owner(tx);
    const offset = Number.isSafeInteger(offsetMs) ? Number(offsetMs) : 0;
    await this.#create(tx, eventId, {
      aggregateId: scheduleId,
      templateCode: "CHECKIN_REMINDER",
      templateContext: {
        remaining: remaining(offset),
        deadline_at: text(schedule.deadline_at, "check-in deadline"),
        action_url: new URL("/owner/check-in", this.publicBaseUrl).href,
      },
      recipient: {
        type: "OWNER_PRIMARY",
        email: owner.primaryEmail,
        ...(owner.backupEmail === undefined ? {} : { backupEmail: owner.backupEmail }),
      },
      suffix: "owner",
    });
  }

  async #materializeReleaseReminder(
    tx: TransactionContext,
    eventId: string,
    workflowId: string,
    offsetMs?: number,
  ) {
    const workflow = await tx.repositories.workflows.findById(workflowId, { forUpdate: true });
    if (workflow === null || workflow.state !== "RELEASE_PENDING") return;
    const owner = await this.#owner(tx);
    await this.#create(tx, eventId, {
      aggregateId: workflowId,
      templateCode: "DEATH_STAGE2_REMINDER",
      templateContext: {
        remaining: releaseRemaining(Number.isSafeInteger(offsetMs) ? Number(offsetMs) : 0),
        release_at: text(workflow.release_at, "release deadline"),
        action_url: new URL(`/owner/workflows/${workflowId}`, this.publicBaseUrl).href,
      },
      recipient: {
        type: "OWNER_PRIMARY",
        email: owner.primaryEmail,
        ...(owner.backupEmail === undefined ? {} : { backupEmail: owner.backupEmail }),
      },
      suffix: "owner",
    });
  }

  async #materializeCancelledByContact(
    tx: TransactionContext,
    eventId: string,
    workflowId: string,
    denierId?: string,
    now?: string,
  ) {
    const owner = await this.#owner(tx);
    const denier =
      denierId === undefined ? undefined : await this.#contactSnapshot(tx, workflowId, denierId);
    await this.#create(tx, eventId, {
      aggregateId: workflowId,
      templateCode: "DEATH_CANCELLED_BY_CONTACT",
      templateContext: {
        owner_name: owner.ownerName,
        denier_name: denier?.name ?? "紧急联系人",
        denier_email: denier?.email ?? "",
        cancelled_at: now ?? new Date().toISOString(),
      },
      recipient: {
        type: "OWNER_PRIMARY",
        email: owner.primaryEmail,
        ...(owner.backupEmail === undefined ? {} : { backupEmail: owner.backupEmail }),
      },
      suffix: "owner",
    });
  }

  async #materializeCancelledByOwner(
    tx: TransactionContext,
    eventId: string,
    workflowId: string,
    now: string,
  ) {
    const owner = await this.#owner(tx);
    await this.#materializeContactFanout(tx, workflowId, async (contact) => {
      await this.#create(tx, eventId, {
        aggregateId: workflowId,
        templateCode: "DEATH_CANCELLED_BY_OWNER",
        templateContext: { owner_name: owner.ownerName, cancelled_at: now },
        recipient: { type: "CONTACT", email: contact.email, ref: contact.id },
        suffix: `contact:${contact.id}`,
      });
    });
  }

  async #materializePublicationReleased(
    tx: TransactionContext,
    eventId: string,
    workflowId: string,
    contactId?: string,
  ) {
    const publication = await tx.repositories.publications?.findOneBy?.("workflow_id", workflowId, {
      forUpdate: true,
    });
    if (publication === null || publication === undefined) return;
    const ids =
      contactId === undefined
        ? (await this.#workflowContacts(tx, workflowId)).map((row) => String(row.contact_id))
        : [contactId];
    for (const id of ids) {
      const contact = await this.#contactSnapshot(tx, workflowId, id);
      const sha256 = Buffer.from(bytes(publication.zip_sha256, "publication digest")).toString(
        "hex",
      );
      await this.#create(tx, eventId, {
        aggregateId: workflowId,
        templateCode: "LEGACY_RELEASED",
        templateContext: {
          owner_name: text(publication.owner_display_name, "publication owner name"),
          published_at: text(publication.published_at, "publication timestamp"),
          legacy_url: new URL("/public/legacy", this.publicBaseUrl).href,
          download_url: new URL("/public/legacy/package", this.publicBaseUrl).href,
          sha256,
        },
        recipient: { type: "CONTACT", email: contact.email, ref: id },
        suffix: `contact:${id}`,
      });
    }
  }
}

export function createNotificationMaterializeHandler(): NotificationMaterializeHandler {
  const config = loadWorkerConfig();
  return new NotificationMaterializeHandler(
    new PgTransactionManager(createPgPool({ connectionString: config.databaseUrl })),
    new AesFieldProtector(config.security.fieldKeyring, config.security.sessionSecret),
    new AesNotificationCipher(config.security.fieldKeyring, config.security.sessionSecret),
    new StrictEmailTemplateRenderer(),
    config.publicBaseUrl,
  );
}
