import { InMemorySessionStore, SessionService } from "@dls/application";
import { Module } from "@nestjs/common";
import { CsrfGuard } from "./csrf.guard.js";
import { OriginGuard } from "./origin.guard.js";
import { RateLimitGuard } from "./rate-limit.guard.js";
import { ContactSessionGuard, OwnerSessionGuard, SESSION_SERVICE } from "./session.guard.js";

function sessionServiceFactory(): SessionService {
  const pepper = new TextEncoder().encode(
    process.env.SESSION_PEPPER ?? "local-development-session-pepper",
  );
  return new SessionService(new InMemorySessionStore(), { pepper });
}

@Module({
  providers: [
    { provide: SESSION_SERVICE, useFactory: sessionServiceFactory },
    OwnerSessionGuard,
    ContactSessionGuard,
    CsrfGuard,
    OriginGuard,
    RateLimitGuard,
  ],
  exports: [
    SESSION_SERVICE,
    OwnerSessionGuard,
    ContactSessionGuard,
    CsrfGuard,
    OriginGuard,
    RateLimitGuard,
  ],
})
export class SecurityModule {}
