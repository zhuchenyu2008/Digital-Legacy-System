import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { Injectable } from "@nestjs/common";

type GuardRequest = Readonly<{
  method?: string;
  headers?: Readonly<Record<string, string | string[] | undefined>>;
}>;

function readOrigin(request: GuardRequest): string | undefined {
  const value = request.headers?.origin;
  return Array.isArray(value) ? value[0] : value;
}

@Injectable()
export class OriginGuard implements CanActivate {
  readonly #allowedOrigins: ReadonlySet<string>;

  public constructor(allowedOrigins: readonly string[] = ["http://localhost:3000"]) {
    this.#allowedOrigins = new Set(allowedOrigins.map((origin) => new URL(origin).origin));
  }

  public canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<GuardRequest>();
    const method = request.method;
    const origin = readOrigin(request);
    this.assert({
      ...(method === undefined ? {} : { method }),
      ...(origin === undefined ? {} : { origin }),
    });
    return true;
  }

  public assert(input: { method?: string; origin?: string }): void {
    const method = (input.method ?? "GET").toUpperCase();
    if (["GET", "HEAD", "OPTIONS"].includes(method)) return;
    if (input.origin === undefined || !this.#allowedOrigins.has(input.origin)) {
      throw new Error("Origin is not allowed");
    }
  }
}
