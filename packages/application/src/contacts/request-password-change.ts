import { addExactDays } from "@dls/domain";
import type { TransactionManager } from "../ports/transaction-manager.js";
import { ContactUseCaseError, digestToken, makeToken, repository } from "./contact-common.js";

export type RequestContactPasswordChangeResult = Readonly<{
  contactId: string;
  token: string;
  expiresAt: string;
}>;

export type PasswordChangeNotificationInput = Readonly<{
  ownerId: string;
  contactId: string;
  tokenId: string;
  recipientEmail: string;
  ownerName: string;
  token: string;
  expiresAt: string;
}>;

export async function requestContactPasswordChange(
  command: Readonly<{ ownerId: string; contactId: string; password: string; requestId: string }>,
  dependencies: Readonly<{
    transaction: TransactionManager;
    tokenPepper: Uint8Array;
    passwordVerifier: (password: string, encodedHash: string) => Promise<boolean>;
    tokenFactory?: () => Uint8Array;
    idFactory?: () => string;
    queuePasswordChangeNotification?: (
      input: PasswordChangeNotificationInput,
      tx: import("../ports/transaction-manager.js").TransactionContext,
    ) => Promise<string>;
  }>,
): Promise<RequestContactPasswordChangeResult> {
  const idFactory = dependencies.idFactory ?? (() => crypto.randomUUID());
  return dependencies.transaction.run(async (tx) => {
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
    const contact = await tx.repositories.contacts.findById(command.contactId, { forUpdate: true });
    if (contact === null || contact.status === "REMOVED" || contact.status === "INVITED") {
      throw new ContactUseCaseError("CONTACT_NOT_FOUND", "contact is unavailable", 404);
    }
    const tokens = repository(tx.repositories.oneTimeTokens, "one-time tokens");
    const now = await tx.clock.now();
    const token = makeToken(dependencies.tokenFactory);
    const tokenId = idFactory();
    const expiresAt = addExactDays(now, 1);
    await tokens.insert({
      id: tokenId,
      purpose: "CONTACT_PASSWORD_CHANGE",
      subject_type: "CONTACT",
      subject_id: command.contactId,
      token_hash: digestToken(token, dependencies.tokenPepper),
      token_hmac_key_version: 1,
      expires_at: expiresAt,
    });
    await tx.audit.append({
      eventId: idFactory(),
      occurredAt: now,
      eventType: "CONTACT_PASSWORD_CHANGE_REQUESTED",
      actorType: "OWNER",
      aggregateType: "contact",
      aggregateId: command.contactId,
      requestId: command.requestId,
      result: "SUCCESS",
      metadata: { tokenId, expiresAt },
    });
    await tx.outbox.enqueue({
      eventType: "CONTACT_PASSWORD_CHANGE_REQUESTED",
      aggregateType: "contact",
      aggregateId: command.contactId,
      payload: { tokenId, expiresAt },
      idempotencyKey: `contact-password-change:${tokenId}`,
      availableAt: now,
    });
    if (dependencies.queuePasswordChangeNotification !== undefined) {
      await dependencies.queuePasswordChangeNotification(
        {
          ownerId: command.ownerId,
          contactId: command.contactId,
          tokenId,
          recipientEmail: String(contact.email ?? ""),
          ownerName: command.ownerId,
          token,
          expiresAt,
        },
        tx,
      );
    }
    return { contactId: command.contactId, token, expiresAt };
  });
}
