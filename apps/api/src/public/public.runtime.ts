import { resolve } from "node:path";
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
import { getApiRuntimeConfig } from "../config/api-runtime-config.js";

export const PUBLIC_RUNTIME = Symbol("DLS_PUBLIC_RUNTIME");

export type PublicDownload = Awaited<ReturnType<typeof openPublicDownload>>;

export interface PublicRuntime {
  publication(): Promise<PublicPublication | null>;
  audit(): ReturnType<typeof getPublicationAudit>;
  download(range?: Readonly<{ start: number; endInclusive?: number }>): Promise<PublicDownload>;
}

function positiveEnvironmentInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function storageFromEnvironment(environment: Record<string, string | undefined>) {
  if (environment.STORAGE_DRIVER === "s3") {
    const region = environment.S3_REGION ?? "us-east-1";
    return createStorage({
      driver: "s3",
      endpoint: environment.S3_ENDPOINT ?? `https://s3.${region}.amazonaws.com`,
      region,
      forcePathStyle: environment.S3_FORCE_PATH_STYLE === "true",
      privateBucket: environment.S3_PRIVATE_BUCKET ?? "dls-private",
      publicBucket: environment.S3_PUBLIC_BUCKET ?? "dls-public",
      accessKeyId: environment.S3_ACCESS_KEY_ID ?? "missing",
      secretAccessKey: environment.S3_SECRET_ACCESS_KEY ?? "missing",
    });
  }
  return createStorage({
    driver: "filesystem",
    privateRoot: resolve(environment.STORAGE_PRIVATE_ROOT ?? ".data/objects/private"),
    stagingRoot: resolve(environment.STORAGE_STAGING_ROOT ?? ".data/objects/staging"),
    publicRoot: resolve(environment.STORAGE_PUBLIC_ROOT ?? ".data/objects/public"),
  });
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
  environment: Record<string, string | undefined> = process.env,
): PublicRuntime {
  const config = getApiRuntimeConfig(environment);
  return new PostgresPublicRuntime(
    new PgTransactionManager(createPgPool({ connectionString: config.databaseUrl })),
    storageFromEnvironment(environment),
    positiveEnvironmentInteger(environment.PUBLIC_DOWNLOAD_MAX_CONCURRENCY, 4),
    positiveEnvironmentInteger(environment.PUBLIC_DOWNLOAD_BYTES_PER_SECOND, 8 * 1024 * 1024),
  );
}
