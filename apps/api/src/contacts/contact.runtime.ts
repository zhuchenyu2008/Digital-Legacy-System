import {
  type AcceptContactInvitationCommand,
  type AcceptContactInvitationResult,
  acceptContactInvitation,
  type ChangeContactPasswordResult,
  type ContactPrivateKeyEnvelope,
  changeContactPassword,
  createNotificationInTransaction,
  getContactCryptoMaterial,
  type InviteContactCommand,
  type InviteContactResult,
  inviteContact,
  loginContact,
  type RequestContactPasswordChangeResult,
  removeContact,
  requestContactPasswordChange,
  resendContactInvitation,
  type SessionService,
  viewContactInvitation,
} from "@dls/application";
import { AesNotificationCipher, hashServerPassword, verifyServerPassword } from "@dls/crypto/node";
import { renderTemplate, TEMPLATE_CODES, type TemplateCode } from "@dls/email-templates";
import { createPgPool, PgTransactionManager } from "@dls/persistence";
import { getApiRuntimeConfig } from "../config/api-runtime-config.js";
import { AesFieldProtector } from "../setup/setup.runtime.js";

export const CONTACT_RUNTIME = Symbol("DLS_CONTACT_RUNTIME");

export interface ContactRuntime {
  list(): Promise<
    readonly Readonly<{
      id: string;
      displayName: string;
      email: string;
      status: string;
      consentVersion?: string;
    }>[]
  >;
  invite(command: InviteContactCommand): Promise<InviteContactResult>;
  resend(
    command: Readonly<{ ownerId: string; contactId: string; requestId: string }>,
  ): Promise<InviteContactResult>;
  requestPasswordChange(
    command: Readonly<{ ownerId: string; contactId: string; password: string; requestId: string }>,
  ): Promise<RequestContactPasswordChangeResult>;
  resolve(token: string): ReturnType<typeof viewContactInvitation>;
  accept(command: AcceptContactInvitationCommand): Promise<AcceptContactInvitationResult>;
  login(
    command: Readonly<{
      displayName: string;
      password: string;
      requestId: string;
      ip?: string;
      userAgent?: string;
    }>,
  ): ReturnType<typeof loginContact>;
  changePassword(
    command: Readonly<{
      contactId?: string;
      oldPassword: string;
      newPassword: string;
      newPrivateKeyEnvelope: ContactPrivateKeyEnvelope;
      requestId: string;
      currentSessionToken?: string;
      token?: string;
    }>,
  ): Promise<ChangeContactPasswordResult>;
  cryptoMaterial(contactId: string): ReturnType<typeof getContactCryptoMaterial>;
  remove(
    command: Readonly<{ ownerId: string; contactId: string; password: string; requestId: string }>,
  ): ReturnType<typeof removeContact>;
}

export class PostgresContactRuntime implements ContactRuntime {
  readonly #transaction: PgTransactionManager;
  readonly #sessions: SessionService;
  readonly #tokenPepper: Uint8Array;
  readonly #passwordPepper: Uint8Array;
  readonly #ownerPasswordPepper: Uint8Array;
  readonly #protector: AesFieldProtector;
  readonly #consentVersion: string;
  readonly #consentDocumentSha256: Uint8Array;
  readonly #config = getApiRuntimeConfig();
  readonly #notificationCipher = new AesNotificationCipher(this.#config.sessionSecret);

  public constructor(transaction: PgTransactionManager, sessions: SessionService) {
    this.#transaction = transaction;
    this.#sessions = sessions;
    this.#tokenPepper = this.#config.tokenPepper;
    this.#passwordPepper = this.#config.contactPasswordPepper;
    this.#ownerPasswordPepper = this.#config.tokenPepper;
    this.#protector = new AesFieldProtector(this.#config.sessionSecret);
    this.#consentVersion = this.#config.contactConsentVersion;
    this.#consentDocumentSha256 = Buffer.from(this.#config.contactConsentSha256, "hex");
  }

  public invite(command: InviteContactCommand) {
    return inviteContact(command, {
      transaction: this.#transaction,
      tokenPepper: this.#tokenPepper,
      fieldProtector: this.#protector,
      emailLookupHmac: (email) => this.#protector.lookup(email),
      queueInvitationNotification: async (input, tx) => {
        const owner = await tx.repositories.ownerProfile.findById(true);
        if (owner === null) throw new Error("Owner profile is unavailable");
        const ownerName = await this.#protector.unprotect(
          {
            ciphertext: Uint8Array.from(owner.display_name_ciphertext as ArrayLike<number>),
            nonce: Uint8Array.from(owner.display_name_nonce as ArrayLike<number>),
            keyVersion: Number(owner.display_name_key_version),
          },
          "owner-display-name",
        );
        const actionUrl = new URL("/contact-invitations", this.#config.publicBaseUrl);
        actionUrl.hash = new URLSearchParams({ invite: input.token }).toString();
        const created = await createNotificationInTransaction(
          {
            eventId: crypto.randomUUID(),
            aggregateId: input.contactId,
            aggregateType: "contact",
            templateCode: "CONTACT_INVITATION",
            templateContext: {
              owner_name: ownerName,
              contact_name: input.contactName,
              expires_at: input.expiresAt,
              action_url: actionUrl.href,
            },
            recipient: {
              type: "CONTACT",
              email: input.recipientEmail,
              ref: input.contactId,
            },
            idempotencyKey: `contact-invitation-notification:${input.invitationId}`,
          },
          tx,
          {
            cipher: this.#notificationCipher,
            renderer: {
              render: (code, context) => {
                if (!TEMPLATE_CODES.includes(code as TemplateCode)) {
                  throw new Error("Unknown email template code");
                }
                return renderTemplate(code as TemplateCode, context);
              },
            },
          },
        );
        return created.notificationId;
      },
    });
  }

  public list() {
    return this.#transaction.run(async (tx) => {
      const contacts = (await tx.repositories.contacts.findMany?.()) ?? [];
      const output: Array<
        Readonly<{
          id: string;
          displayName: string;
          email: string;
          status: string;
          consentVersion?: string;
        }>
      > = [];
      for (const contact of contacts) {
        if (contact.status === "REMOVED") continue;
        const displayName = await this.#protector.unprotect(
          {
            ciphertext: Uint8Array.from(contact.display_name_ciphertext as ArrayLike<number>),
            nonce: Uint8Array.from(contact.display_name_nonce as ArrayLike<number>),
            keyVersion: Number(contact.display_name_key_version),
          },
          "contact-display-name",
        );
        const email = await this.#protector.unprotect(
          {
            ciphertext: Uint8Array.from(contact.email_ciphertext as ArrayLike<number>),
            nonce: Uint8Array.from(contact.email_nonce as ArrayLike<number>),
            keyVersion: Number(contact.email_key_version),
          },
          "contact-email",
        );
        const consents =
          (await tx.repositories.contactConsents?.findMany?.("contact_id", contact.id)) ?? [];
        const consent = consents.at(-1);
        output.push({
          id: String(contact.id),
          displayName,
          email,
          status: String(contact.status),
          ...(typeof consent?.consent_version === "string"
            ? { consentVersion: consent.consent_version }
            : {}),
        });
      }
      return Object.freeze(output);
    });
  }

  public resend(command: Readonly<{ ownerId: string; contactId: string; requestId: string }>) {
    return resendContactInvitation(command, {
      transaction: this.#transaction,
      tokenPepper: this.#tokenPepper,
    });
  }

  public resolve(token: string) {
    return viewContactInvitation(token, {
      transaction: this.#transaction,
      tokenPepper: this.#tokenPepper,
    });
  }

  public requestPasswordChange(
    command: Readonly<{ ownerId: string; contactId: string; password: string; requestId: string }>,
  ) {
    return requestContactPasswordChange(command, {
      transaction: this.#transaction,
      tokenPepper: this.#tokenPepper,
      passwordVerifier: (password, hash) =>
        verifyServerPassword(password, this.#ownerPasswordPepper, hash),
    });
  }

  public accept(command: AcceptContactInvitationCommand) {
    return acceptContactInvitation(command, {
      transaction: this.#transaction,
      tokenPepper: this.#tokenPepper,
      fieldProtector: this.#protector,
      passwordHasher: (password) => hashServerPassword(password, this.#passwordPepper),
      consentVersion: this.#consentVersion,
      consentDocumentSha256: this.#consentDocumentSha256,
      sessionService: this.#sessions,
    });
  }

  public login(
    command: Readonly<{
      displayName: string;
      password: string;
      requestId: string;
      ip?: string;
      userAgent?: string;
    }>,
  ) {
    return loginContact(command, {
      transaction: this.#transaction,
      contactLookupHmac: (displayName) => this.#protector.lookup(displayName),
      passwordVerifier: (password, hash) =>
        verifyServerPassword(password, this.#passwordPepper, hash),
      sessionService: this.#sessions,
    });
  }

  public changePassword(
    command: Readonly<{
      contactId?: string;
      oldPassword: string;
      newPassword: string;
      newPrivateKeyEnvelope: ContactPrivateKeyEnvelope;
      requestId: string;
      currentSessionToken?: string;
      token?: string;
    }>,
  ) {
    return changeContactPassword(command, {
      transaction: this.#transaction,
      sessionService: this.#sessions,
      passwordVerifier: (password, hash) =>
        verifyServerPassword(password, this.#passwordPepper, hash),
      passwordHasher: (password) => hashServerPassword(password, this.#passwordPepper),
      tokenPepper: this.#tokenPepper,
    });
  }

  public cryptoMaterial(contactId: string) {
    return getContactCryptoMaterial(contactId, this.#transaction);
  }

  public remove(
    command: Readonly<{ ownerId: string; contactId: string; password: string; requestId: string }>,
  ) {
    return removeContact(command, {
      transaction: this.#transaction,
      sessionService: this.#sessions,
      passwordVerifier: (password, hash) =>
        verifyServerPassword(password, this.#ownerPasswordPepper, hash),
    });
  }
}

export function createContactRuntime(sessions: SessionService): ContactRuntime {
  const pool = createPgPool({
    connectionString: getApiRuntimeConfig().databaseUrl,
  });
  return new PostgresContactRuntime(new PgTransactionManager(pool), sessions);
}
