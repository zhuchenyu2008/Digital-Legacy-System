import type { SessionActorType, SessionService } from "@dls/application";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { getApiRuntimeConfig } from "../config/api-runtime-config.js";
import { sessionCookieName } from "./session-cookies.js";

export const SESSION_SERVICE = Symbol("DLS_SESSION_SERVICE");

export type SecurityRequest = {
  method?: string;
  headers?: Readonly<Record<string, string | string[] | undefined>>;
  cookies?: Readonly<Record<string, string | undefined>>;
  user?: unknown;
  sessionToken?: string;
  sessionActorType?: SessionActorType;
};

function parseCookieHeader(header: string | undefined): Readonly<Record<string, string>> {
  if (header === undefined) return {};
  return Object.fromEntries(
    header.split(";").flatMap((part) => {
      const separator = part.indexOf("=");
      if (separator < 1) return [];
      return [
        [part.slice(0, separator).trim(), decodeURIComponent(part.slice(separator + 1).trim())],
      ];
    }),
  );
}

export function readSessionToken(
  request: SecurityRequest,
  actorType: SessionActorType,
  secure = true,
): string | undefined {
  const cookieName = sessionCookieName(actorType, secure);
  const header = request.headers?.cookie;
  const parsed = parseCookieHeader(Array.isArray(header) ? header[0] : header);
  return request.cookies?.[cookieName] ?? parsed[cookieName];
}

@Injectable()
export class SessionGuard implements CanActivate {
  public constructor(
    @Inject(SESSION_SERVICE) private readonly sessions: SessionService,
    private readonly actorType: SessionActorType = "OWNER",
  ) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<SecurityRequest>();
    const token = readSessionToken(
      request,
      this.actorType,
      getApiRuntimeConfig().nodeEnv === "production",
    );
    if (token === undefined) throw new UnauthorizedException("authentication is required");
    try {
      request.user = await this.sessions.authenticate(token, { actorType: this.actorType });
      request.sessionToken = token;
      request.sessionActorType = this.actorType;
      return true;
    } catch {
      throw new UnauthorizedException("authentication is required");
    }
  }
}

@Injectable()
export class OwnerSessionGuard extends SessionGuard {
  public constructor(@Inject(SESSION_SERVICE) sessions: SessionService) {
    super(sessions, "OWNER");
  }
}

@Injectable()
export class ContactSessionGuard extends SessionGuard {
  public constructor(@Inject(SESSION_SERVICE) sessions: SessionService) {
    super(sessions, "CONTACT");
  }
}
