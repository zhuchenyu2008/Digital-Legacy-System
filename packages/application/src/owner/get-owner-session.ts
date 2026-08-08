import type { SessionPrincipal } from "../auth/session.js";
import type { SessionService } from "../auth/session-service.js";

export type OwnerSessionResult = Readonly<{
  authenticated: true;
  role: "OWNER";
  actor: SessionPrincipal;
}>;

export async function getOwnerSession(
  token: string,
  sessionService: SessionService,
): Promise<OwnerSessionResult> {
  const actor = await sessionService.authenticate(token, { actorType: "OWNER" });
  return { authenticated: true, role: "OWNER", actor };
}
