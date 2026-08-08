import type { SessionService } from "@dls/application";
import {
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
  type UpdateOwnerSettingsCommand,
  type UpdateOwnerSettingsResult,
  updateOwnerSettings,
} from "@dls/application";
import { hashServerPassword, verifyServerPassword } from "@dls/crypto/node";
import { createPgPool, PgTransactionManager } from "@dls/persistence";

export const OWNER_RUNTIME = Symbol("DLS_OWNER_RUNTIME");

export interface OwnerRuntime {
  login(command: OwnerLoginCommand): Promise<OwnerLoginResult>;
  checkIn(command: OwnerCheckInCommand): ReturnType<typeof checkInOwner>;
  getSettings(): ReturnType<typeof getOwnerSettings>;
  updateSettings(command: UpdateOwnerSettingsCommand): Promise<UpdateOwnerSettingsResult>;
  getSchedule(): ReturnType<typeof getOwnerCheckInSchedule>;
  changePassword(command: ChangeOwnerPasswordCommand): Promise<ChangeOwnerPasswordResult>;
  session(token: string): Promise<OwnerSessionResult>;
  logout(token: string): Promise<void>;
}

function secretBytes(value: string | undefined, fallback: string): Uint8Array {
  return Uint8Array.from(
    Buffer.from(value ?? Buffer.from(fallback, "utf8").toString("base64"), "base64"),
  );
}

export class PostgresOwnerRuntime implements OwnerRuntime {
  readonly #transaction: PgTransactionManager;
  readonly #sessions: SessionService;
  readonly #passwordPepper: Uint8Array;

  public constructor(transaction: PgTransactionManager, sessions: SessionService) {
    this.#transaction = transaction;
    this.#sessions = sessions;
    this.#passwordPepper = secretBytes(
      process.env.TOKEN_PEPPER,
      "local-token-pepper-0123456789012345",
    );
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

  public session(token: string) {
    return getOwnerSession(token, this.#sessions);
  }

  public logout(token: string) {
    return this.#sessions.revoke(token);
  }
}

export function createOwnerRuntime(sessions: SessionService): OwnerRuntime {
  const pool = createPgPool({
    connectionString: process.env.DATABASE_URL ?? "postgresql://postgres:test@127.0.0.1:55432/dls",
  });
  return new PostgresOwnerRuntime(new PgTransactionManager(pool), sessions);
}
