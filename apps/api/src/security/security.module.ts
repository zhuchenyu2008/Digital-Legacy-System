import { SessionService } from "@dls/application";
import { createPgPool, PgSessionStore } from "@dls/persistence";
import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { getApiRuntimeConfig } from "../config/api-runtime-config.js";
import { CsrfGuard } from "./csrf.guard.js";
import { ALLOWED_ORIGINS, OriginGuard } from "./origin.guard.js";
import { RateLimitGuard } from "./rate-limit.guard.js";
import { ContactSessionGuard, OwnerSessionGuard, SESSION_SERVICE } from "./session.guard.js";

function sessionServiceFactory(): SessionService {
  const config = getApiRuntimeConfig();
  return new SessionService(
    new PgSessionStore(createPgPool({ connectionString: config.databaseUrl })),
    { pepper: config.sessionPepper },
  );
}

@Module({
  providers: [
    { provide: SESSION_SERVICE, useFactory: sessionServiceFactory },
    { provide: ALLOWED_ORIGINS, useFactory: () => getApiRuntimeConfig().allowedOrigins },
    OwnerSessionGuard,
    ContactSessionGuard,
    CsrfGuard,
    OriginGuard,
    { provide: APP_GUARD, useExisting: OriginGuard },
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
