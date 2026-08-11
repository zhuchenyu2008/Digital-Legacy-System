import type { TransactionManager } from "../ports/transaction-manager.js";
import { ContactUseCaseError, digestToken, repository } from "./contact-common.js";

export async function viewContactInvitation(
  token: string,
  dependencies: Readonly<{ transaction: TransactionManager; tokenPepper: Uint8Array }>,
) {
  if (typeof token !== "string" || token.length < 40) {
    throw new ContactUseCaseError("CONTACT_INVITATION_INVALID", "invitation is invalid", 404);
  }
  return dependencies.transaction.run(async (tx) => {
    const invitations = repository(tx.repositories.contactInvitations, "contact invitations");
    const invitation = await invitations.findOneBy?.(
      "token_hash",
      digestToken(token, dependencies.tokenPepper),
      {
        forUpdate: true,
      },
    );
    const now = await tx.clock.now();
    if (
      invitation === null ||
      invitation === undefined ||
      (invitation.consumed_at !== null && invitation.consumed_at !== undefined) ||
      (invitation.revoked_at !== null && invitation.revoked_at !== undefined) ||
      typeof invitation.expires_at !== "string" ||
      Date.parse(now) >= Date.parse(invitation.expires_at)
    ) {
      throw new ContactUseCaseError("CONTACT_INVITATION_INVALID", "invitation is invalid", 404);
    }
    const contact = await tx.repositories.contacts.findById(invitation.contact_id);
    if (contact === null || contact.status !== "INVITED") {
      throw new ContactUseCaseError("CONTACT_INVITATION_INVALID", "invitation is invalid", 404);
    }
    const [settings, vaults] = await Promise.all([
      tx.repositories.systemSettings.findById(true),
      tx.repositories.vaults.findMany?.() ?? Promise.resolve([]),
    ]);
    if (
      settings === null ||
      typeof settings.contact_consent_version !== "string" ||
      !(settings.contact_consent_sha256 instanceof Uint8Array) ||
      settings.contact_consent_sha256.length !== 32 ||
      vaults.length !== 1
    ) {
      throw new ContactUseCaseError(
        "CONTACT_UNAVAILABLE",
        "invitation context is unavailable",
        503,
      );
    }
    return {
      contactId: String(contact.id),
      status: contact.status,
      expiresAt: invitation.expires_at,
      vaultId: String(vaults[0]?.id),
      consentVersion: settings.contact_consent_version,
      consentDocumentSha256: Buffer.from(settings.contact_consent_sha256).toString("hex"),
    };
  });
}
