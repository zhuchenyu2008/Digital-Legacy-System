import type { IssuedSession } from "../auth/session.js";
import type { SessionService } from "../auth/session-service.js";
import type { TransactionManager } from "../ports/transaction-manager.js";
import { ContactUseCaseError, decodeBase64Url, normalizeContactName } from "./contact-common.js";

export type ContactLoginResult = Readonly<{
  role: "CONTACT";
  contactId: string;
  status: "PENDING_KEYING" | "ACTIVE";
  session: IssuedSession;
  cryptoMaterial: Readonly<{
    publicKey: string;
    privateKeyEnvelope: Readonly<{
      ciphertext: string;
      nonce: string;
      kdfSalt: string;
      kdfParams: unknown;
    }>;
  }>;
}>;

export async function loginContact(
  command: Readonly<{
    displayName: string;
    password: string;
    requestId: string;
    ip?: string;
    userAgent?: string;
  }>,
  dependencies: Readonly<{
    transaction: TransactionManager;
    contactLookupHmac: (displayName: string) => Promise<Uint8Array>;
    passwordVerifier: (password: string, encodedHash: string) => Promise<boolean>;
    sessionService: SessionService;
  }>,
): Promise<ContactLoginResult> {
  const displayName = normalizeContactName(command.displayName);
  const lookup = await dependencies.contactLookupHmac(displayName);
  const result = await dependencies.transaction.run(async (tx) => {
    const contact = await tx.repositories.contacts.findOneBy?.(
      "display_name_lookup_hmac",
      Buffer.from(lookup),
      { forUpdate: true },
    );
    if (
      contact === null ||
      contact === undefined ||
      (contact.status !== "PENDING_KEYING" && contact.status !== "ACTIVE") ||
      typeof contact.password_phc !== "string" ||
      !(await dependencies.passwordVerifier(command.password, contact.password_phc))
    ) {
      throw new ContactUseCaseError(
        "CONTACT_LOGIN_INVALID",
        "contact credentials are invalid",
        401,
      );
    }
    const publicKey = encodeBytes(contact.x25519_public_key, "public key", 32, 32);
    const privateKeyCiphertext = encodeBytes(
      contact.private_key_ciphertext,
      "private key ciphertext",
      2,
    );
    const privateKeyNonce = encodeBytes(contact.private_key_nonce, "private key nonce", 8);
    const privateKeyKdfSalt = encodeBytes(contact.private_key_kdf_salt, "private key KDF salt", 8);
    await tx.audit.append({
      eventId: crypto.randomUUID(),
      occurredAt: await tx.clock.now(),
      eventType: "CONTACT_LOGIN",
      actorType: "CONTACT",
      aggregateType: "contact",
      aggregateId: String(contact.id),
      requestId: command.requestId,
      result: "SUCCESS",
    });
    return {
      contactId: String(contact.id),
      status: contact.status as "PENDING_KEYING" | "ACTIVE",
      credentialVersion: Number(contact.credential_version ?? contact.version ?? 0),
      cryptoMaterial: {
        publicKey,
        privateKeyEnvelope: {
          ciphertext: privateKeyCiphertext,
          nonce: privateKeyNonce,
          kdfSalt: privateKeyKdfSalt,
          kdfParams: contact.private_key_kdf_params,
        },
      },
    };
  });
  const session = await dependencies.sessionService.create({
    actorType: "CONTACT",
    actorId: result.contactId,
    credentialVersion: result.credentialVersion,
    ...(command.ip === undefined ? {} : { ip: command.ip }),
    ...(command.userAgent === undefined ? {} : { userAgent: command.userAgent }),
  });
  return { role: "CONTACT", ...result, session };
}

function encodeBytes(
  value: unknown,
  field: string,
  minimumLength: number,
  exactLength?: number,
): string {
  if (!(value instanceof Uint8Array)) {
    throw new ContactUseCaseError("CONTACT_KEY_INVALID", `${field} is unavailable`, 409);
  }
  return Buffer.from(
    decodeBase64Url(Buffer.from(value).toString("base64url"), field, minimumLength, exactLength),
  ).toString("base64url");
}
