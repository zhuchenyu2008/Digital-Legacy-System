import { SESSION_COOKIE_NAMES, type SessionActorType } from "@dls/application";
import type { FastifyReply } from "fastify";
import { getApiRuntimeConfig } from "../config/api-runtime-config.js";

const CSRF_COOKIE_NAMES: Readonly<Record<SessionActorType, string>> = Object.freeze({
  OWNER: "dls-owner-csrf",
  CONTACT: "dls-contact-csrf",
});

function attributes(secure: boolean): string {
  return `Path=/; SameSite=Strict${secure ? "; Secure" : ""}`;
}

export function sessionCookieName(actorType: SessionActorType, secure: boolean): string {
  if (secure) return SESSION_COOKIE_NAMES[actorType];
  return actorType === "OWNER" ? "dls-owner" : "dls-contact";
}

export function sessionCookieHeaders(
  actorType: SessionActorType,
  token: string,
  csrfToken: string,
  secure: boolean,
): readonly string[] {
  const common = attributes(secure);
  return Object.freeze([
    `${sessionCookieName(actorType, secure)}=${encodeURIComponent(token)}; ${common}; HttpOnly`,
    `${CSRF_COOKIE_NAMES[actorType]}=${encodeURIComponent(csrfToken)}; ${common}`,
  ]);
}

export function clearedSessionCookieHeaders(
  actorType: SessionActorType,
  secure: boolean,
): readonly string[] {
  const common = attributes(secure);
  return Object.freeze([
    `${sessionCookieName(actorType, secure)}=; Max-Age=0; ${common}; HttpOnly`,
    `${CSRF_COOKIE_NAMES[actorType]}=; Max-Age=0; ${common}`,
  ]);
}

export function setSessionCookies(
  response: Pick<FastifyReply, "header">,
  actorType: SessionActorType,
  token: string,
  csrfToken: string,
): void {
  response.header(
    "set-cookie",
    sessionCookieHeaders(
      actorType,
      token,
      csrfToken,
      getApiRuntimeConfig().nodeEnv === "production",
    ),
  );
}

export function clearSessionCookies(
  response: Pick<FastifyReply, "header">,
  actorType: SessionActorType,
): void {
  response.header(
    "set-cookie",
    clearedSessionCookieHeaders(actorType, getApiRuntimeConfig().nodeEnv === "production"),
  );
}
