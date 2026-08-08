import type { SessionService } from "@dls/application";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { readSessionToken, SESSION_SERVICE, type SecurityRequest } from "./session.guard.js";

@Injectable()
export class CsrfGuard implements CanActivate {
  public constructor(@Inject(SESSION_SERVICE) private readonly sessions: SessionService) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<SecurityRequest>();
    if (["GET", "HEAD", "OPTIONS"].includes((request.method ?? "GET").toUpperCase())) return true;
    const token =
      request.sessionToken ?? readSessionToken(request, request.sessionActorType ?? "OWNER");
    const csrfHeader = request.headers?.["x-csrf-token"];
    const csrfToken = Array.isArray(csrfHeader) ? csrfHeader[0] : csrfHeader;
    if (token === undefined || csrfToken === undefined)
      throw new ForbiddenException("CSRF token is invalid");
    try {
      await this.sessions.verifyCsrf(token, csrfToken);
      return true;
    } catch {
      throw new ForbiddenException("CSRF token is invalid");
    }
  }
}
