export type SessionActorType = "OWNER" | "CONTACT";

export const SESSION_COOKIE_NAMES: Readonly<Record<SessionActorType, string>> = Object.freeze({
  OWNER: "__Host-dls-owner",
  CONTACT: "__Host-dls-contact",
});

export type SessionPrincipal = Readonly<{
  sessionId: string;
  actorType: SessionActorType;
  actorId: string;
  credentialVersion: number;
  createdAt: string;
  lastSeenAt: string;
  idleExpiresAt: string;
  absoluteExpiresAt: string;
}>;

export type SessionRecord = Readonly<
  SessionPrincipal & {
    tokenHash: string;
    csrfTokenHash: string;
    revokedAt?: string;
    ipDigest?: string;
    userAgentDigest?: string;
  }
>;

export type IssuedSession = Readonly<{
  token: string;
  csrfToken: string;
  principal: SessionPrincipal;
}>;

export class SessionError extends Error {
  public constructor(
    public readonly code: "SESSION_INVALID" | "CSRF_INVALID" | "SESSION_LIMIT",
    message: string,
    public readonly status = code === "CSRF_INVALID" ? 403 : 401,
  ) {
    super(message);
    this.name = "SessionError";
  }
}
