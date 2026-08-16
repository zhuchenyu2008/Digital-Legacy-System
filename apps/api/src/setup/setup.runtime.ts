import type {
  FieldProtector,
  OwnerSetupCommand,
  OwnerSetupResult,
  SetupStatus,
  TransactionManager,
} from "@dls/application";
import { createOwner, getSetupStatus, type SessionService } from "@dls/application";
import { AesFieldProtector, hashServerPassword } from "@dls/crypto/node";
import { createPgPool, PgTransactionManager } from "@dls/persistence";
import { getApiRuntimeConfig } from "../config/api-runtime-config.js";

export const SETUP_RUNTIME = Symbol("DLS_SETUP_RUNTIME");

export interface SetupRuntime {
  getStatus(): Promise<SetupStatus>;
  createOwner(command: OwnerSetupCommand): Promise<OwnerSetupResult>;
}

export { AesFieldProtector } from "@dls/crypto/node";

export function secretBytes(value: string | undefined, fallback: string): Uint8Array {
  return Uint8Array.from(
    Buffer.from(value ?? Buffer.from(fallback, "utf8").toString("base64"), "base64"),
  );
}

export class PostgresSetupRuntime implements SetupRuntime {
  readonly #transaction: TransactionManager;
  readonly #expectedSetupToken: string;
  readonly #passwordPepper: Uint8Array;
  readonly #protector: FieldProtector;
  readonly #sessions: SessionService;
  readonly #config = getApiRuntimeConfig();

  public constructor(transaction: TransactionManager, sessions: SessionService) {
    this.#transaction = transaction;
    this.#expectedSetupToken = this.#config.setupToken;
    this.#passwordPepper = this.#config.tokenPepper;
    this.#protector = new AesFieldProtector(this.#config.fieldKeyring, this.#config.sessionSecret);
    this.#sessions = sessions;
  }

  public getStatus(): Promise<SetupStatus> {
    return getSetupStatus(this.#transaction);
  }

  public createOwner(command: OwnerSetupCommand): Promise<OwnerSetupResult> {
    return createOwner(command, {
      transaction: this.#transaction,
      expectedSetupToken: this.#expectedSetupToken,
      passwordHasher: (password) => hashServerPassword(password, this.#passwordPepper),
      protector: this.#protector,
      sessionService: this.#sessions,
      publicBaseUrl: this.#config.publicBaseUrl,
      smtpConfigured: this.#config.smtpConfigured,
    });
  }
}

export function createSetupRuntime(sessions: SessionService): SetupRuntime {
  const pool = createPgPool({
    connectionString: getApiRuntimeConfig().databaseUrl,
  });
  return new PostgresSetupRuntime(new PgTransactionManager(pool), sessions);
}
