import type { SessionService } from "@dls/application";
import {
  type ArmOwnerCommand,
  type ArmOwnerResult,
  armOwner,
  type ChangeOwnerPasswordCommand,
  type ChangeOwnerPasswordResult,
  changeOwnerPassword,
  checkInOwner,
  getOwnerCheckInSchedule,
  getOwnerSession,
  getOwnerSettings,
  loginOwner,
  type OwnerCheckInCommand,
  type OwnerLoginCommand,
  type OwnerLoginResult,
  type OwnerSessionResult,
  testSmtp,
  type UpdateOwnerSettingsCommand,
  type UpdateOwnerSettingsResult,
  updateOwnerSettings,
} from "@dls/application";
import { hashServerPassword, verifyServerPassword } from "@dls/crypto/node";
import { createPgPool, PgTransactionManager } from "@dls/persistence";
import { getApiRuntimeConfig } from "../config/api-runtime-config.js";
import { AesFieldProtector } from "../setup/setup.runtime.js";
import { SmtpProbe, smtpTransportSettings } from "./smtp-probe.js";

export const OWNER_RUNTIME = Symbol("DLS_OWNER_RUNTIME");

export interface OwnerRuntime {
  login(command: OwnerLoginCommand): Promise<OwnerLoginResult>;
  checkIn(command: OwnerCheckInCommand): ReturnType<typeof checkInOwner>;
  getSettings(): ReturnType<typeof getOwnerSettings>;
  updateSettings(command: UpdateOwnerSettingsCommand): Promise<UpdateOwnerSettingsResult>;
  getSchedule(): ReturnType<typeof getOwnerCheckInSchedule>;
  changePassword(command: ChangeOwnerPasswordCommand): Promise<ChangeOwnerPasswordResult>;
  arm(command: ArmOwnerCommand): Promise<ArmOwnerResult>;
  smtpTest(
    command: Readonly<{ ownerId: string; requestId: string }>,
  ): Promise<
    Readonly<{ status: "SUCCESS" | "FAILED"; smtpStatusClass?: number; errorCode?: string }>
  >;
  session(token: string): Promise<OwnerSessionResult>;
  logout(token: string): Promise<void>;
}

export class PostgresOwnerRuntime implements OwnerRuntime {
  readonly #transaction: PgTransactionManager;
  readonly #sessions: SessionService;
  readonly #passwordPepper: Uint8Array;
  readonly #fieldProtector: AesFieldProtector;

  public constructor(transaction: PgTransactionManager, sessions: SessionService) {
    this.#transaction = transaction;
    this.#sessions = sessions;
    this.#passwordPepper = getApiRuntimeConfig().tokenPepper;
    this.#fieldProtector = new AesFieldProtector(getApiRuntimeConfig().sessionSecret);
  }

  public login(command: OwnerLoginCommand): Promise<OwnerLoginResult> {
    return loginOwner(command, {
      transaction: this.#transaction,
      sessionService: this.#sessions,
      passwordVerifier: (password, hash) =>
        verifyServerPassword(password, this.#passwordPepper, hash),
    });
  }

  public checkIn(command: OwnerCheckInCommand) {
    return checkInOwner(command, {
      transaction: this.#transaction,
      passwordVerifier: (password, hash) =>
        verifyServerPassword(password, this.#passwordPepper, hash),
    });
  }

  public getSettings() {
    return getOwnerSettings(this.#transaction);
  }

  public updateSettings(command: UpdateOwnerSettingsCommand) {
    return updateOwnerSettings(command, {
      transaction: this.#transaction,
      passwordVerifier: (password, hash) =>
        verifyServerPassword(password, this.#passwordPepper, hash),
    });
  }

  public getSchedule() {
    return getOwnerCheckInSchedule(this.#transaction);
  }

  public changePassword(command: ChangeOwnerPasswordCommand) {
    return changeOwnerPassword(command, {
      transaction: this.#transaction,
      sessionService: this.#sessions,
      passwordVerifier: (password, hash) =>
        verifyServerPassword(password, this.#passwordPepper, hash),
      passwordHasher: (password) => hashServerPassword(password, this.#passwordPepper),
    });
  }

  public arm(command: ArmOwnerCommand) {
    return armOwner(command, {
      transaction: this.#transaction,
      passwordVerifier: (password, hash) =>
        verifyServerPassword(password, this.#passwordPepper, hash),
    });
  }

  public async smtpTest(command: Readonly<{ ownerId: string; requestId: string }>) {
    const config = getApiRuntimeConfig();
    const recipient = await this.#transaction.run(async (tx) => {
      const owner = await tx.repositories.ownerProfile.findById(true);
      if (owner === null) throw new Error("owner profile is unavailable");
      return this.#fieldProtector.unprotect(
        {
          ciphertext: new Uint8Array(owner.primary_email_ciphertext as Uint8Array),
          nonce: new Uint8Array(owner.primary_email_nonce as Uint8Array),
          keyVersion: Number(owner.primary_email_key_version),
        },
        "owner-primary-email",
      );
    });
    const probe = new SmtpProbe(
      smtpTransportSettings(config.mailTransportUrl, config.nodeEnv),
      config.mailFrom,
    );
    return testSmtp(
      { ...command, recipient },
      {
        transaction: this.#transaction,
        probe: (to) => probe.send(to),
      },
    );
  }

  public session(token: string) {
    return getOwnerSession(token, this.#sessions);
  }

  public logout(token: string) {
    return this.#sessions.revoke(token);
  }
}

export function createOwnerRuntime(sessions: SessionService): OwnerRuntime {
  const pool = createPgPool({
    connectionString: getApiRuntimeConfig().databaseUrl,
  });
  return new PostgresOwnerRuntime(new PgTransactionManager(pool), sessions);
}
