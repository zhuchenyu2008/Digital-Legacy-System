import type { SessionService } from "../auth/session-service.js";
import type { TransactionManager } from "../ports/transaction-manager.js";
import { ContactUseCaseError } from "./contact-common.js";

const ACTIVE_WORKFLOW_STATES = [
  "AWAITING_CONFIRMATIONS",
  "GRACE_PERIOD",
  "AWAITING_APPROVALS",
  "REWRAP_PENDING",
  "DEATH_CONFIRMING",
  "RELEASE_PENDING",
  "PASSWORD_RECOVERY",
] as const;

export async function removeContact(
  command: Readonly<{ ownerId: string; contactId: string; password: string; requestId: string }>,
  dependencies: Readonly<{
    transaction: TransactionManager;
    passwordVerifier: (password: string, encodedHash: string) => Promise<boolean>;
    sessionService?: SessionService;
  }>,
) {
  const result = await dependencies.transaction.run(
    async (tx) => {
      const credentials = await tx.repositories.ownerCredentials.findById(true, {
        forUpdate: true,
      });
      if (
        credentials === null ||
        typeof credentials.password_phc !== "string" ||
        !(await dependencies.passwordVerifier(command.password, credentials.password_phc))
      ) {
        throw new ContactUseCaseError(
          "OWNER_REAUTH_REQUIRED",
          "owner reauthentication is required",
          401,
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
      const contact = await tx.repositories.contacts.findById(command.contactId, {
        forUpdate: true,
      });
      if (contact === null || contact.status === "REMOVED") {
        throw new ContactUseCaseError("CONTACT_NOT_FOUND", "contact is unavailable", 404);
      }
      const active = (await tx.repositories.contacts.findMany?.("status", "ACTIVE")) ?? [];
      if (contact.status === "ACTIVE" && active.length <= 3) {
        throw new ContactUseCaseError(
          "CONTACT_MINIMUM",
          "at least three active contacts are required",
          422,
        );
      }
      const now = await tx.clock.now();
      await tx.repositories.contacts.updateVersioned(contact.id, Number(contact.version ?? 0), {
        status: "REMOVED",
        removed_at: now,
        credential_version: Number(contact.credential_version ?? 0) + 1,
        active_share_generation_id: null,
      });
      const settings = await tx.repositories.systemSettings.findById(true, { forUpdate: true });
      if (settings !== null) {
        await tx.repositories.systemSettings.updateVersioned(true, Number(settings.version ?? 0), {
          contact_set_version: Number(settings.contact_set_version ?? 0) + 1,
        });
      }
      await tx.audit.append({
        eventId: crypto.randomUUID(),
        occurredAt: now,
        eventType: "CONTACT_REMOVED",
        actorType: "OWNER",
        aggregateType: "contact",
        aggregateId: command.contactId,
        requestId: command.requestId,
        result: "SUCCESS",
      });
      await tx.outbox.enqueue({
        eventType: "CONTACT_REMOVED",
        aggregateType: "contact",
        aggregateId: command.contactId,
        payload: { status: "CONFIGURING", shareGenerationRequired: true },
        idempotencyKey: `contact-removed:${command.requestId}`,
        availableAt: now,
      });
      return { contactId: command.contactId, status: "CONFIGURING" as const };
    },
    { isolation: "serializable" },
  );
  if (dependencies.sessionService !== undefined)
    await dependencies.sessionService.revokeAll("CONTACT", result.contactId);
  return result;
}
