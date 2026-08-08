import { InMemorySessionStore, SessionService } from "@dls/application";
import { Module } from "@nestjs/common";
import { getApiRuntimeConfig } from "../config/api-runtime-config.js";
import { CsrfGuard } from "./csrf.guard.js";
import { ALLOWED_ORIGINS, OriginGuard } from "./origin.guard.js";
import { RateLimitGuard } from "./rate-limit.guard.js";
import { ContactSessionGuard, OwnerSessionGuard, SESSION_SERVICE } from "./session.guard.js";

function sessionServiceFactory(): SessionService {
  const pepper = getApiRuntimeConfig().sessionPepper;
  return new SessionService(new InMemorySessionStore(), { pepper });
}

@Module({
  providers: [
    { provide: SESSION_SERVICE, useFactory: sessionServiceFactory },
    { provide: ALLOWED_ORIGINS, useFactory: () => getApiRuntimeConfig().allowedOrigins },
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
