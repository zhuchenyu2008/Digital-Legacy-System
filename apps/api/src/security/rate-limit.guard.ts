import { createHash } from "node:crypto";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { HttpException, HttpStatus, Inject, Injectable, Optional } from "@nestjs/common";
import type { Pool } from "pg";

export type RateLimitDecision = Readonly<{
  allowed: boolean;
  retryAfterSeconds: number;
}>;

type Bucket = Readonly<{ windowStartedAt: number; attempts: number }>;

export type RateLimiterOptions = Readonly<{
  windowMs: number;
  maxAttempts: number;
}>;

export interface RateLimiterStore {
  consume(key: string, now?: number): RateLimitDecision | Promise<RateLimitDecision>;
}

export class RateLimiter {
  readonly #windowMs: number;
  readonly #maxAttempts: number;
  readonly #buckets = new Map<string, Bucket>();

  public constructor(options: RateLimiterOptions) {
    if (!Number.isSafeInteger(options.windowMs) || options.windowMs < 1000)
      throw new RangeError("windowMs must be at least one second");
    if (!Number.isSafeInteger(options.maxAttempts) || options.maxAttempts < 1)
      throw new RangeError("maxAttempts must be positive");
    this.#windowMs = options.windowMs;
    this.#maxAttempts = options.maxAttempts;
  }

  public consume(key: string, now = Date.now()): RateLimitDecision {
    const current = this.#buckets.get(key);
    const bucket =
      current === undefined || now - current.windowStartedAt >= this.#windowMs
        ? { windowStartedAt: now, attempts: 0 }
        : current;
    const attempts = bucket.attempts + 1;
    this.#buckets.set(key, { windowStartedAt: bucket.windowStartedAt, attempts });
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((bucket.windowStartedAt + this.#windowMs - now) / 1000),
    );
    return { allowed: attempts <= this.#maxAttempts, retryAfterSeconds };
  }
}

export class PostgresRateLimiter implements RateLimiterStore {
  public constructor(
    private readonly database: Pick<Pool, "query">,
    private readonly options: RateLimiterOptions,
  ) {}

  public async consume(key: string, now = Date.now()): Promise<RateLimitDecision> {
    const bucketKey = createHash("sha256").update(key, "utf8").digest();
    const nowDate = new Date(now);
    const result = await this.database.query(
      `INSERT INTO app.rate_limit_buckets (bucket_key, window_started_at, attempt_count, blocked_until)
       VALUES ($1, $2::timestamptz, 1, NULL)
       ON CONFLICT (bucket_key) DO UPDATE
       SET window_started_at = CASE
             WHEN EXTRACT(EPOCH FROM ($2::timestamptz - app.rate_limit_buckets.window_started_at)) * 1000 >= $3
               THEN $2::timestamptz
             ELSE app.rate_limit_buckets.window_started_at
           END,
           attempt_count = CASE
             WHEN EXTRACT(EPOCH FROM ($2::timestamptz - app.rate_limit_buckets.window_started_at)) * 1000 >= $3
               THEN 1
             ELSE app.rate_limit_buckets.attempt_count + 1
           END,
           blocked_until = CASE
             WHEN EXTRACT(EPOCH FROM ($2::timestamptz - app.rate_limit_buckets.window_started_at)) * 1000 >= $3
               THEN NULL
             ELSE app.rate_limit_buckets.blocked_until
           END,
           updated_at = clock_timestamp()
       RETURNING window_started_at, attempt_count`,
      [bucketKey, nowDate.toISOString(), this.options.windowMs],
    );
    const row = result.rows[0] as
      | { window_started_at?: unknown; attempt_count?: unknown }
      | undefined;
    if (row === undefined) throw new Error("rate limiter did not return a bucket");
    const windowStartedAt = Date.parse(String(row.window_started_at));
    const attempts = Number(row.attempt_count);
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((windowStartedAt + this.options.windowMs - now) / 1000),
    );
    return { allowed: attempts <= this.options.maxAttempts, retryAfterSeconds };
  }
}

export const RATE_LIMITER_OWNER = Symbol("DLS_RATE_LIMITER_OWNER");
export const RATE_LIMITER_CONTACT = Symbol("DLS_RATE_LIMITER_CONTACT");
export const RATE_LIMITER_RECOVERY = Symbol("DLS_RATE_LIMITER_RECOVERY");
export const RATE_LIMITER_TOKEN = Symbol("DLS_RATE_LIMITER_TOKEN");

@Injectable()
export class RateLimitGuard implements CanActivate {
  public constructor(
    @Optional()
    private readonly limiter: RateLimiterStore = new RateLimiter({
      windowMs: 60_000,
      maxAttempts: 30,
    }),
    @Optional() private readonly key = "request",
  ) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ ip?: string }>();
    const decision = await this.limiter.consume(`${this.key}:${request.ip ?? "unknown"}`);
    if (!decision.allowed) {
      throw new HttpException(
        { code: "RATE_LIMITED", retryAfterSeconds: decision.retryAfterSeconds },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}

@Injectable()
export class OwnerRateLimitGuard extends RateLimitGuard {
  public constructor(@Inject(RATE_LIMITER_OWNER) limiter: RateLimiterStore) {
    super(limiter, "owner");
  }
}

@Injectable()
export class ContactRateLimitGuard extends RateLimitGuard {
  public constructor(@Inject(RATE_LIMITER_CONTACT) limiter: RateLimiterStore) {
    super(limiter, "contact");
  }
}

@Injectable()
export class RecoveryRateLimitGuard extends RateLimitGuard {
  public constructor(@Inject(RATE_LIMITER_RECOVERY) limiter: RateLimiterStore) {
    super(limiter, "recovery");
  }
}

@Injectable()
export class TokenRateLimitGuard extends RateLimitGuard {
  public constructor(@Inject(RATE_LIMITER_TOKEN) limiter: RateLimiterStore) {
    super(limiter, "token");
  }
}
