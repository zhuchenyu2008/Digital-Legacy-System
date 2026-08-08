import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { HttpException, HttpStatus, Injectable } from "@nestjs/common";

export type RateLimitDecision = Readonly<{
  allowed: boolean;
  retryAfterSeconds: number;
}>;

type Bucket = Readonly<{ windowStartedAt: number; attempts: number }>;

export type RateLimiterOptions = Readonly<{
  windowMs: number;
  maxAttempts: number;
}>;

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

@Injectable()
export class RateLimitGuard implements CanActivate {
  public constructor(
    private readonly limiter = new RateLimiter({ windowMs: 60_000, maxAttempts: 30 }),
    private readonly key = "request",
  ) {}

  public canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ ip?: string }>();
    const decision = this.limiter.consume(`${this.key}:${request.ip ?? "unknown"}`);
    if (!decision.allowed) {
      throw new HttpException(
        { code: "RATE_LIMITED", retryAfterSeconds: decision.retryAfterSeconds },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
