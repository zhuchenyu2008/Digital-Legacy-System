import type { IssuedSession } from "../auth/session.js";
import type { SessionService } from "../auth/session-service.js";
import type { TransactionManager } from "../ports/transaction-manager.js";
import type { FieldProtector } from "../setup/field-protector.js";
import {
  type ContactConsentInput,
  type ContactPrivateKeyEnvelope,
  ContactUseCaseError,
  decodeBase64Url,
  decodeHex,
  digestToken,
  repository,
  validatePassword,
} from "./contact-common.js";

export type AcceptContactInvitationCommand = Readonly<{
  token: string;
  password: string;
  privateKeyEnvelope: ContactPrivateKeyEnvelope;
  consent: ContactConsentInput;
  requestId: string;
  ip?: string;
  userAgent?: string;
}>;

export type AcceptContactInvitationResult = Readonly<{
  contactId: string;
  status: "PENDING_KEYING";
  session: IssuedSession;
}>;

function validateEnvelope(envelope: ContactPrivateKeyEnvelope): void {
  decodeBase64Url(envelope.publicKey, "publicKey", 32, 32);
  decodeBase64Url(envelope.ciphertext, "private key ciphertext", 2);
  decodeBase64Url(envelope.nonce, "private key nonce", 8);
  decodeBase64Url(envelope.kdfSalt, "private key KDF salt", 8);
  decodeBase64Url(envelope.privateKeyProof, "private key proof", 2);
  if (
    envelope.kdfParams.algorithm !== "argon2id" ||
    envelope.kdfParams.memoryKiB !== 65_536 ||
    envelope.kdfParams.iterations !== 3 ||
    envelope.kdfParams.parallelism !== 1 ||
    envelope.kdfParams.version !== 19 ||
    envelope.kdfParams.purpose !== "contact-private-key-kek-v1"
  ) {
    throw new ContactUseCaseError("CONTACT_KEY_INVALID", "contact KDF profile is invalid");
  }
}

export async function acceptContactInvitation(
  command: AcceptContactInvitationCommand,
  dependencies: Readonly<{
    transaction: TransactionManager;
    tokenPepper: Uint8Array;
    fieldProtector: FieldProtector;
    passwordHasher: (password: string) => Promise<string>;
    consentVersion: string;
    consentDocumentSha256: Uint8Array;
    sessionService: SessionService;
    idFactory?: () => string;
  }>,
): Promise<AcceptContactInvitationResult> {
  validatePassword(command.password);
  validateEnvelope(command.privateKeyEnvelope);
  if (
    command.consent.version !== dependencies.consentVersion ||
    !command.consent.termsAccepted ||
    !command.consent.privacyAccepted ||
    !command.consent.denialDisclosureAccepted ||
    !command.consent.stage2LockAccepted ||
    !sameBytes(
      decodeHex(command.consent.documentSha256, "documentSha256", 32),
      dependencies.consentDocumentSha256,
    )
  ) {
    throw new ContactUseCaseError("CONTACT_CONSENT_INVALID", "consent is invalid");
  }
  const idFactory = dependencies.idFactory ?? (() => crypto.randomUUID());
  const result = await dependencies.transaction.run(
    async (tx) => {
      const invitations = repository(tx.repositories.contactInvitations, "contact invitations");
      const invitation = await invitations.findOneBy?.(
        "token_hash",
        digestToken(command.token, dependencies.tokenPepper),
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
      const contact = await tx.repositories.contacts.findById(invitation.contact_id, {
        forUpdate: true,
      });
      if (contact === null || contact.status !== "INVITED") {
        throw new ContactUseCaseError("CONTACT_INVITATION_INVALID", "invitation is invalid", 404);
      }
      const passwordHash = await dependencies.passwordHasher(command.password);
      const envelope = command.privateKeyEnvelope;
      await tx.repositories.contacts.updateVersioned(contact.id, Number(contact.version ?? 0), {
        status: "PENDING_KEYING",
        password_phc: passwordHash,
        password_changed_at: now,
        password_pepper_version: 1,
        password_kdf_version: 1,
        password_normalization_version: 1,
        credential_version: Number(contact.credential_version ?? 0) + 1,
        x25519_public_key: decodeBase64Url(envelope.publicKey, "publicKey", 32, 32),
        private_key_ciphertext: decodeBase64Url(envelope.ciphertext, "private key ciphertext", 2),
        private_key_nonce: decodeBase64Url(envelope.nonce, "private key nonce", 8),
        private_key_kdf_salt: decodeBase64Url(envelope.kdfSalt, "private key KDF salt", 8),
        private_key_kdf_params: envelope.kdfParams,
        registered_at: now,
      });
      const ip = await dependencies.fieldProtector.protect(
        command.ip ?? "unknown",
        "contact-consent-ip",
      );
      const userAgent = await dependencies.fieldProtector.protect(
        command.userAgent ?? "unknown",
        "contact-consent-user-agent",
      );
      await repository(tx.repositories.contactConsents, "contact consents").insert({
        id: idFactory(),
        contact_id: contact.id,
        consent_version: command.consent.version,
        document_sha256: decodeHex(command.consent.documentSha256, "documentSha256", 32),
        terms_accepted: true,
        privacy_accepted: true,
        denial_disclosure_accepted: true,
        stage2_lock_accepted: true,
        accepted_at: now,
        ip_ciphertext: ip.ciphertext,
        ip_nonce: ip.nonce,
        ip_key_version: ip.keyVersion,
        user_agent_ciphertext: userAgent.ciphertext,
        user_agent_nonce: userAgent.nonce,
        user_agent_key_version: userAgent.keyVersion,
      });
      if (typeof invitations.updateById !== "function") {
        throw new ContactUseCaseError(
          "CONTACT_UNAVAILABLE",
          "invitation repository cannot consume tokens",
          503,
        );
      }
      await invitations.updateById(invitation.id, { consumed_at: now });
      await tx.audit.append({
        eventId: idFactory(),
        occurredAt: now,
        eventType: "CONTACT_INVITATION_ACCEPTED",
        actorType: "CONTACT",
        aggregateType: "contact",
        aggregateId: String(contact.id),
        requestId: command.requestId,
        result: "SUCCESS",
        metadata: { consentVersion: command.consent.version },
      });
      await tx.outbox.enqueue({
        eventType: "CONTACT_INVITATION_ACCEPTED",
        aggregateType: "contact",
        aggregateId: String(contact.id),
        payload: { status: "PENDING_KEYING" },
        idempotencyKey: `contact-accept:${invitation.id}`,
        availableAt: now,
      });
      return {
        contactId: String(contact.id),
        status: "PENDING_KEYING" as const,
        credentialVersion: Number(contact.credential_version ?? 0) + 1,
      };
    },
    { isolation: "serializable" },
  );
  const session = await dependencies.sessionService.create({
    actorType: "CONTACT",
    actorId: result.contactId,
    credentialVersion: result.credentialVersion,
    ...(command.ip === undefined ? {} : { ip: command.ip }),
    ...(command.userAgent === undefined ? {} : { userAgent: command.userAgent }),
  });
  return { contactId: result.contactId, status: result.status, session };
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1)
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  return difference === 0;
}
