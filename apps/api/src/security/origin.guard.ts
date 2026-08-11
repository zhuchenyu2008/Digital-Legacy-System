import type { CanActivate, ExecutionContext } from "@nestjs/common";
import {
  ForbiddenException,
  Inject,
  Injectable,
  Optional,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import { getApiRuntimeConfig } from "../config/api-runtime-config.js";

export const ALLOWED_ORIGINS = Symbol("DLS_ALLOWED_ORIGINS");

const SIMPLE_FORM_CONTENT_TYPES = new Set([
  "application/x-www-form-urlencoded",
  "multipart/form-data",
  "text/plain",
]);

type GuardRequest = Readonly<{
  method?: string;
  headers?: Readonly<Record<string, string | string[] | undefined>>;
}>;

function readHeader(request: GuardRequest, name: string): string | undefined {
  const value = request.headers?.[name];
  return Array.isArray(value) ? value[0] : value;
}

@Injectable()
export class OriginGuard implements CanActivate {
  readonly #allowedOrigins: ReadonlySet<string>;

  public constructor(
    @Optional()
    @Inject(ALLOWED_ORIGINS)
    allowedOrigins: readonly string[] = getApiRuntimeConfig().allowedOrigins,
  ) {
    this.#allowedOrigins = new Set(allowedOrigins.map((origin) => new URL(origin).origin));
  }

  public canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<GuardRequest>();
    const method = request.method;
    const origin = readHeader(request, "origin");
    const fetchSite = readHeader(request, "sec-fetch-site");
    const contentType = readHeader(request, "content-type");
    this.assert({
      ...(method === undefined ? {} : { method }),
      ...(origin === undefined ? {} : { origin }),
      ...(fetchSite === undefined ? {} : { fetchSite }),
      ...(contentType === undefined ? {} : { contentType }),
    });
    return true;
  }

  public assert(input: {
    method?: string;
    origin?: string;
    fetchSite?: string;
    contentType?: string;
  }): void {
    const method = (input.method ?? "GET").toUpperCase();
    if (["GET", "HEAD"].includes(method)) return;
    const mediaType = input.contentType?.split(";", 1)[0]?.trim().toLowerCase();
    if (mediaType !== undefined && SIMPLE_FORM_CONTENT_TYPES.has(mediaType)) {
      throw new UnsupportedMediaTypeException("Simple form content types are not allowed");
    }
    if (input.origin === undefined || !this.#allowedOrigins.has(input.origin)) {
      throw new ForbiddenException("Origin is not allowed");
    }
    if (input.fetchSite?.toLowerCase() !== "same-origin") {
      throw new ForbiddenException("Sec-Fetch-Site must be same-origin");
    }
  }
}
