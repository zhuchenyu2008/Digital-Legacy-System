import {
  type AcceptContactInvitationCommand,
  type AcceptContactInvitationResult,
  acceptContactInvitation,
  type ChangeContactPasswordResult,
  type ContactPrivateKeyEnvelope,
  changeContactPassword,
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
import { hashServerPassword, verifyServerPassword } from "@dls/crypto/node";
import { createPgPool, PgTransactionManager } from "@dls/persistence";
import { AesFieldProtector, secretBytes } from "../setup/setup.runtime.js";

export const CONTACT_RUNTIME = Symbol("DLS_CONTACT_RUNTIME");

export interface ContactRuntime {
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

  public constructor(transaction: PgTransactionManager, sessions: SessionService) {
    this.#transaction = transaction;
    this.#sessions = sessions;
    this.#tokenPepper = secretBytes(
      process.env.TOKEN_PEPPER,
      "local-token-pepper-0123456789012345",
    );
    this.#passwordPepper = secretBytes(
      process.env.CONTACT_PASSWORD_PEPPER,
      "local-contact-password-pepper-0123456789012345",
    );
    this.#ownerPasswordPepper = secretBytes(
      process.env.TOKEN_PEPPER,
      "local-token-pepper-0123456789012345",
    );
    this.#protector = new AesFieldProtector(
      secretBytes(process.env.SESSION_SECRET, "local-session-secret-0123456789012345"),
    );
    this.#consentVersion = process.env.CONTACT_CONSENT_VERSION ?? "2026-08-01";
    this.#consentDocumentSha256 = Buffer.from(
      process.env.CONTACT_CONSENT_SHA256 ?? "00".repeat(32),
      "hex",
    );
  }

  public invite(command: InviteContactCommand) {
    return inviteContact(command, {
      transaction: this.#transaction,
      tokenPepper: this.#tokenPepper,
      fieldProtector: this.#protector,
      emailLookupHmac: (email) => this.#protector.lookup(email),
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
    connectionString: process.env.DATABASE_URL ?? "postgresql://postgres:test@127.0.0.1:55432/dls",
  });
  return new PostgresContactRuntime(new PgTransactionManager(pool), sessions);
}
