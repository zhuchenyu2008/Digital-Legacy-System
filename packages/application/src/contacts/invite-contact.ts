import { addExactDays } from "@dls/domain";
import type { TransactionContext, TransactionManager } from "../ports/transaction-manager.js";
import type { FieldProtector } from "../setup/field-protector.js";
import {
  ContactUseCaseError,
  digestToken,
  makeToken,
  normalizeContactName,
  normalizeEmail,
  repository,
} from "./contact-common.js";

export type InviteContactCommand = Readonly<{
  ownerId: string;
  displayName: string;
  email: string;
  requestId: string;
}>;

export type InviteContactResult = Readonly<{
  contactId: string;
  invitationId: string;
  token: string;
  expiresAt: string;
}>;

export type InvitationNotificationInput = Readonly<{
  ownerId: string;
  contactId: string;
  invitationId: string;
  contactName: string;
  recipientEmail: string;
  token: string;
  expiresAt: string;
}>;

export type ResendContactInvitationCommand = Readonly<{
  ownerId: string;
  contactId: string;
  requestId: string;
}>;

const ACTIVE_WORKFLOW_STATES = [
  "AWAITING_CONFIRMATIONS",
  "GRACE_PERIOD",
  "AWAITING_APPROVALS",
  "REWRAP_PENDING",
  "DEATH_CONFIRMING",
  "RELEASE_PENDING",
  "PASSWORD_RECOVERY",
] as const;

export async function inviteContact(
  command: InviteContactCommand,
  dependencies: Readonly<{
    transaction: TransactionManager;
    tokenPepper: Uint8Array;
    tokenFactory?: () => Uint8Array;
    idFactory?: () => string;
    fieldProtector: FieldProtector;
    emailLookupHmac: (email: string) => Promise<Uint8Array>;
    queueInvitationNotification?: (
      input: InvitationNotificationInput,
      tx: TransactionContext,
    ) => Promise<string>;
  }>,
): Promise<InviteContactResult> {
  const displayName = normalizeContactName(command.displayName);
  const email = normalizeEmail(command.email);
  const idFactory = dependencies.idFactory ?? (() => crypto.randomUUID());
  const emailLookup = await dependencies.emailLookupHmac(email);
  return dependencies.transaction.run(
    async (tx) => {
      const contacts = tx.repositories.contacts;
      const existing = await contacts.findOneBy?.("email_lookup_hmac", Buffer.from(emailLookup), {
        forUpdate: true,
      });
      if (existing !== null && existing !== undefined && existing.status !== "REMOVED") {
        throw new ContactUseCaseError(
          "CONTACT_EMAIL_EXISTS",
          "contact email is already registered",
          409,
        );
      }
      const activeRows = (await contacts.findMany?.()) ?? [];
      if (activeRows.filter((row) => row.status !== "REMOVED").length >= 10) {
        throw new ContactUseCaseError(
          "CONTACT_LIMIT_REACHED",
          "contact limit has been reached",
          422,
        );
      }
      for (const state of ACTIVE_WORKFLOW_STATES) {
        if (
          (await tx.repositories.workflows.findOneBy?.("state", state, { forUpdate: true })) !==
          null
        ) {
          throw new ContactUseCaseError(
            "DLS-CONTACT-LIST-LOCKED",
            "contact list is locked during a workflow",
            423,
          );
        }
      }
      const profile = await dependencies.fieldProtector.protect(
        displayName,
        "contact-display-name",
      );
      const protectedEmail = await dependencies.fieldProtector.protect(email, "contact-email");
      const contactId = idFactory();
      const invitationId = idFactory();
      const token = makeToken(dependencies.tokenFactory);
      const now = await tx.clock.now();
      const expiresAt = addExactDays(now, 3);
      await contacts.insert({
        id: contactId,
        status: "INVITED",
        display_name_ciphertext: protect(profile.ciphertext),
        display_name_nonce: protect(profile.nonce),
        display_name_key_version: profile.keyVersion,
        display_name_lookup_hmac: protect(profile.lookupHmac),
        email_ciphertext: protect(protectedEmail.ciphertext),
        email_nonce: protect(protectedEmail.nonce),
        email_key_version: protectedEmail.keyVersion,
        email_lookup_hmac: Buffer.from(emailLookup),
        credential_version: 0,
      });
      const invitations = repository(tx.repositories.contactInvitations, "contact invitations");
      await invitations.insert({
        id: invitationId,
        contact_id: contactId,
        token_hash: digestToken(token, dependencies.tokenPepper),
        expires_at: expiresAt,
      });
      const settings = await tx.repositories.systemSettings.findById(true, { forUpdate: true });
      if (settings !== null) {
        await tx.repositories.systemSettings.updateVersioned(true, Number(settings.version ?? 0), {
          contact_set_version: Number(settings.contact_set_version ?? 0) + 1,
        });
      }
      await tx.audit.append({
        eventId: idFactory(),
        occurredAt: now,
        eventType: "CONTACT_INVITATION_CREATED",
        actorType: "OWNER",
        aggregateType: "contact",
        aggregateId: contactId,
        requestId: command.requestId,
        result: "SUCCESS",
        metadata: { invitationId, expiresAt },
      });
      await tx.outbox.enqueue({
        eventType: "CONTACT_INVITATION_CREATED",
        aggregateType: "contact",
        aggregateId: contactId,
        payload: { invitationId, expiresAt },
        idempotencyKey: `contact-invitation:${invitationId}`,
        availableAt: now,
      });
      if (dependencies.queueInvitationNotification !== undefined) {
        const notificationId = await dependencies.queueInvitationNotification(
          {
            ownerId: command.ownerId,
            contactId,
            invitationId,
            contactName: displayName,
            recipientEmail: email,
            token,
            expiresAt,
          },
          tx,
        );
        await invitations.updateById?.(invitationId, { notification_id: notificationId });
      }
      return { contactId, invitationId, token, expiresAt };
    },
    { isolation: "serializable" },
  );
}

export async function resendContactInvitation(
  command: ResendContactInvitationCommand,
  dependencies: Readonly<{
    transaction: TransactionManager;
    tokenPepper: Uint8Array;
    tokenFactory?: () => Uint8Array;
    idFactory?: () => string;
  }>,
): Promise<InviteContactResult> {
  const idFactory = dependencies.idFactory ?? (() => crypto.randomUUID());
  return dependencies.transaction.run(
    async (tx) => {
      const contact = await tx.repositories.contacts.findById(command.contactId, {
        forUpdate: true,
      });
      if (contact === null || contact.status !== "INVITED") {
        throw new ContactUseCaseError("CONTACT_INVITATION_INVALID", "invitation is invalid", 404);
      }
      const invitations = repository(tx.repositories.contactInvitations, "contact invitations");
      const previous = await invitations.findOneBy?.("contact_id", command.contactId, {
        forUpdate: true,
      });
      if (
        previous !== null &&
        previous !== undefined &&
        typeof invitations.updateById === "function"
      ) {
        await invitations.updateById(previous.id, { revoked_at: await tx.clock.now() });
      }
      const token = makeToken(dependencies.tokenFactory);
      const invitationId = idFactory();
      const now = await tx.clock.now();
      const expiresAt = addExactDays(now, 3);
      await invitations.insert({
        id: invitationId,
        contact_id: command.contactId,
        token_hash: digestToken(token, dependencies.tokenPepper),
        expires_at: expiresAt,
      });
      await tx.audit.append({
        eventId: idFactory(),
        occurredAt: now,
        eventType: "CONTACT_INVITATION_RESENT",
        actorType: "OWNER",
        aggregateType: "contact",
        aggregateId: command.contactId,
        requestId: command.requestId,
        result: "SUCCESS",
        metadata: { invitationId, expiresAt },
      });
      await tx.outbox.enqueue({
        eventType: "CONTACT_INVITATION_CREATED",
        aggregateType: "contact",
        aggregateId: command.contactId,
        payload: { invitationId, expiresAt },
        idempotencyKey: `contact-invitation:${invitationId}`,
        availableAt: now,
      });
      return { contactId: command.contactId, invitationId, token, expiresAt };
    },
    { isolation: "serializable" },
  );
}

function protect(value: Uint8Array): Buffer {
  return Buffer.from(value);
}
