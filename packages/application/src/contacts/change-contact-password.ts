import type { IssuedSession } from "../auth/session.js";
import type { SessionService } from "../auth/session-service.js";
import type { TransactionManager } from "../ports/transaction-manager.js";
import {
  type ContactPrivateKeyEnvelope,
  ContactUseCaseError,
  decodeBase64Url,
  digestToken,
  repository,
  validatePassword,
} from "./contact-common.js";

export type ChangeContactPasswordResult = Readonly<{ contactId: string; session: IssuedSession }>;

function validateEnvelope(envelope: ContactPrivateKeyEnvelope): Buffer {
  const publicKey = decodeBase64Url(envelope.publicKey, "publicKey", 32, 32);
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
  return publicKey;
}

export async function changeContactPassword(
  command: Readonly<{
    contactId?: string;
    oldPassword: string;
    newPassword: string;
    newPrivateKeyEnvelope: ContactPrivateKeyEnvelope;
    requestId: string;
    currentSessionToken?: string;
    token?: string;
  }>,
  dependencies: Readonly<{
    transaction: TransactionManager;
    sessionService: SessionService;
    passwordVerifier: (password: string, encodedHash: string) => Promise<boolean>;
    passwordHasher: (password: string) => Promise<string>;
    tokenPepper?: Uint8Array;
    idFactory?: () => string;
  }>,
): Promise<ChangeContactPasswordResult> {
  validatePassword(command.newPassword);
  const publicKey = validateEnvelope(command.newPrivateKeyEnvelope);
  if (command.currentSessionToken === undefined && command.token === undefined) {
    throw new ContactUseCaseError(
      "CONTACT_REAUTH_REQUIRED",
      "contact reauthentication is required",
      401,
    );
  }
  const idFactory = dependencies.idFactory ?? (() => crypto.randomUUID());
  const result = await dependencies.transaction.run(
    async (tx) => {
      let contactId = command.contactId;
      let tokenRow: import("../ports/repositories.js").RepositoryRow | null = null;
      if (command.currentSessionToken !== undefined) {
        const principal = await dependencies.sessionService.authenticate(
          command.currentSessionToken,
          {
            actorType: "CONTACT",
            ...(contactId === undefined ? {} : { actorId: contactId }),
          },
        );
        contactId = principal.actorId;
      } else if (command.token !== undefined && dependencies.tokenPepper !== undefined) {
        const tokens = repository(tx.repositories.oneTimeTokens, "one-time tokens");
        tokenRow =
          (await tokens.findOneBy?.(
            "token_hash",
            digestToken(command.token, dependencies.tokenPepper),
            {
              forUpdate: true,
            },
          )) ?? null;
        const now = await tx.clock.now();
        if (
          tokenRow === null ||
          tokenRow.purpose !== "CONTACT_PASSWORD_CHANGE" ||
          tokenRow.consumed_at !== undefined ||
          tokenRow.revoked_at !== undefined ||
          typeof tokenRow.expires_at !== "string" ||
          Date.parse(now) >= Date.parse(tokenRow.expires_at)
        ) {
          throw new ContactUseCaseError("CONTACT_TOKEN_INVALID", "contact token is invalid", 404);
        }
        contactId = String(tokenRow.subject_id);
      }
      if (contactId === undefined)
        throw new ContactUseCaseError(
          "CONTACT_REAUTH_REQUIRED",
          "contact reauthentication is required",
          401,
        );
      const contact = await tx.repositories.contacts.findById(contactId, { forUpdate: true });
      if (
        contact === null ||
        contact.status === "REMOVED" ||
        typeof contact.password_phc !== "string"
      ) {
        throw new ContactUseCaseError(
          "CONTACT_REAUTH_REQUIRED",
          "contact reauthentication is required",
          401,
        );
      }
      if (!(await dependencies.passwordVerifier(command.oldPassword, contact.password_phc))) {
        throw new ContactUseCaseError(
          "CONTACT_REAUTH_REQUIRED",
          "contact reauthentication is required",
          401,
        );
      }
      if (
        !(contact.x25519_public_key instanceof Uint8Array) ||
        !sameBytes(contact.x25519_public_key, publicKey)
      ) {
        throw new ContactUseCaseError(
          "CONTACT_KEY_INVALID",
          "public key cannot be changed during password rotation",
        );
      }
      const now = await tx.clock.now();
      const credentialVersion = Number(contact.credential_version ?? 0) + 1;
      const envelope = command.newPrivateKeyEnvelope;
      await tx.repositories.contacts.updateVersioned(contact.id, Number(contact.version ?? 0), {
        password_phc: await dependencies.passwordHasher(command.newPassword),
        password_changed_at: now,
        password_pepper_version: 1,
        password_kdf_version: 1,
        password_normalization_version: 1,
        credential_version: credentialVersion,
        private_key_ciphertext: decodeBase64Url(envelope.ciphertext, "private key ciphertext", 2),
        private_key_nonce: decodeBase64Url(envelope.nonce, "private key nonce", 8),
        private_key_kdf_salt: decodeBase64Url(envelope.kdfSalt, "private key KDF salt", 8),
        private_key_kdf_params: envelope.kdfParams,
      });
      if (tokenRow !== null) {
        const tokens = repository(tx.repositories.oneTimeTokens, "one-time tokens");
        if (typeof tokens.updateById !== "function")
          throw new ContactUseCaseError(
            "CONTACT_UNAVAILABLE",
            "token repository cannot consume tokens",
            503,
          );
        await tokens.updateById(tokenRow.id, { consumed_at: now });
      }
      await tx.audit.append({
        eventId: idFactory(),
        occurredAt: now,
        eventType: "CONTACT_PASSWORD_CHANGED",
        actorType: "CONTACT",
        aggregateType: "contact",
        aggregateId: contactId,
        requestId: command.requestId,
        result: "SUCCESS",
        metadata: { credentialVersion },
      });
      await tx.outbox.enqueue({
        eventType: "CONTACT_PASSWORD_CHANGED",
        aggregateType: "contact",
        aggregateId: contactId,
        payload: { credentialVersion },
        idempotencyKey: `contact-password-changed:${command.requestId}`,
        availableAt: now,
      });
      return { contactId, credentialVersion };
    },
    { isolation: "serializable" },
  );
  await dependencies.sessionService.revokeAll("CONTACT", result.contactId);
  const session = await dependencies.sessionService.create({
    actorType: "CONTACT",
    actorId: result.contactId,
    credentialVersion: result.credentialVersion,
  });
  return { contactId: result.contactId, session };
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1)
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  return difference === 0;
}
