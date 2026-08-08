import { createCipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import type {
  FieldProtector,
  OwnerSetupCommand,
  OwnerSetupResult,
  SetupStatus,
  TransactionManager,
} from "@dls/application";
import { createOwner, getSetupStatus, type SessionService } from "@dls/application";
import { hashServerPassword } from "@dls/crypto/node";
import { createPgPool, PgTransactionManager } from "@dls/persistence";
import { getApiRuntimeConfig } from "../config/api-runtime-config.js";

export const SETUP_RUNTIME = Symbol("DLS_SETUP_RUNTIME");

export interface SetupRuntime {
  getStatus(): Promise<SetupStatus>;
  createOwner(command: OwnerSetupCommand): Promise<OwnerSetupResult>;
}

export class AesFieldProtector implements FieldProtector {
  readonly #key: Buffer;

  public constructor(secret: Uint8Array) {
    this.#key = createHash("sha256").update(secret).digest();
  }

  public async protect(value: string, purpose: string) {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.#key, nonce);
    cipher.setAAD(Buffer.from(purpose, "utf8"));
    const ciphertext = Buffer.concat([
      cipher.update(value, "utf8"),
      cipher.final(),
      cipher.getAuthTag(),
    ]);
    const lookupHmac = createHmac("sha256", this.#key).update(value, "utf8").digest();
    return { ciphertext, nonce, keyVersion: 1, lookupHmac };
  }

  public async lookup(value: string): Promise<Uint8Array> {
    return createHmac("sha256", this.#key).update(value, "utf8").digest();
  }
}

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
    this.#protector = new AesFieldProtector(this.#config.sessionSecret);
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
    });
  }
}

export function createSetupRuntime(sessions: SessionService): SetupRuntime {
  const pool = createPgPool({
    connectionString: getApiRuntimeConfig().databaseUrl,
  });
  return new PostgresSetupRuntime(new PgTransactionManager(pool), sessions);
}
