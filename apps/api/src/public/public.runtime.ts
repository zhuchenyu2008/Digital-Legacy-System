import {
  getPublication,
  getPublicationAudit,
  openPublicDownload,
  type PublicPublication,
  type TransactionManager,
} from "@dls/application";
import { createPgPool, PgTransactionManager } from "@dls/persistence";
import { createStorage } from "@dls/storage";
import { HttpException, HttpStatus } from "@nestjs/common";
import {
  getPublicRuntimeConfig,
  type PublicRuntimeConfig,
} from "../config/public-runtime-config.js";

export const PUBLIC_RUNTIME = Symbol("DLS_PUBLIC_RUNTIME");

export type PublicDownload = Awaited<ReturnType<typeof openPublicDownload>>;

export interface PublicRuntime {
  status(): Promise<
    Readonly<{
      state: string;
      serverNow: string;
    }>
  >;
  publication(): Promise<PublicPublication | null>;
  audit(): ReturnType<typeof getPublicationAudit>;
  download(range?: Readonly<{ start: number; endInclusive?: number }>): Promise<PublicDownload>;
}

export class PostgresPublicRuntime implements PublicRuntime {
  #activeDownloads = 0;

  public constructor(
    private readonly transaction: TransactionManager,
    private readonly storage: ReturnType<typeof createStorage>,
    private readonly maxConcurrentDownloads: number,
    private readonly bytesPerSecond: number,
  ) {}

  public publication(): Promise<PublicPublication | null> {
    return getPublication(this.transaction);
  }

  public status() {
    return this.transaction.run(async (tx) => {
      const serverNow = await tx.clock.now();
      const publication = await tx.repositories.publications?.findFirst?.();
      if (publication !== null && publication !== undefined)
        return { state: "RELEASED", serverNow };
      const workflows = (await tx.repositories.workflows.findMany?.()) ?? [];
      const active = [...workflows]
        .reverse()
        .find((row) => !["CANCELLED", "EXPIRED", "RELEASED"].includes(String(row.state)));
      if (!active) return { state: "NORMAL", serverNow };
      const state = String(active.state);
      if (
        [
          "AWAITING_CONFIRMATIONS",
          "DEATH_CONFIRMING",
          "AWAITING_APPROVALS",
          "PASSWORD_RECOVERY",
          "REWRAP_PENDING",
          "RELEASE_PENDING",
        ].includes(state)
      )
        return { state: "IN_PROGRESS", serverNow };
      if (state === "PUBLISHING") return { state: "PUBLISHING", serverNow };
      return { state: "NORMAL", serverNow };
    });
  }

  public audit(): ReturnType<typeof getPublicationAudit> {
    return getPublicationAudit(this.transaction);
  }

  public async download(
    range?: Readonly<{ start: number; endInclusive?: number }>,
  ): Promise<PublicDownload> {
    if (this.#activeDownloads >= this.maxConcurrentDownloads) {
      throw new HttpException(
        "public download concurrency limit reached",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    this.#activeDownloads += 1;
    try {
      const opened = await openPublicDownload(range === undefined ? {} : { range }, {
        transaction: this.transaction,
        storage: this.storage,
      });
      const startedAt = Date.now();
      const rate = this.bytesPerSecond;
      const release = () => {
        this.#activeDownloads = Math.max(0, this.#activeDownloads - 1);
      };
      const body = (async function* () {
        let sent = 0;
        try {
          for await (const chunk of opened.body) {
            sent += chunk.length;
            const waitMs = Math.ceil((sent / rate) * 1000 - (Date.now() - startedAt));
            if (waitMs > 0) await new Promise((resolveDelay) => setTimeout(resolveDelay, waitMs));
            yield chunk;
          }
        } finally {
          release();
        }
      })();
      return { ...opened, body };
    } catch (error) {
      this.#activeDownloads = Math.max(0, this.#activeDownloads - 1);
      throw error;
    }
  }
}

export function createPublicRuntime(
  config: PublicRuntimeConfig = getPublicRuntimeConfig(),
): PublicRuntime {
  return new PostgresPublicRuntime(
    new PgTransactionManager(createPgPool({ connectionString: config.databaseUrl })),
    createStorage(config.storage),
    config.maxConcurrentDownloads,
    config.bytesPerSecond,
  );
}
