import { redirect } from "next/navigation";
import { serverApiRequest } from "../api/server-client";

export type OwnerSession = Readonly<{ actorId?: string; csrfToken?: string; role?: string }>;

export async function requireOwner(): Promise<OwnerSession> {
  const response = await serverApiRequest<OwnerSession>("/auth/session");
  if (response.status === 401) redirect("/login");
  if (!response.data || (response.data.role !== undefined && response.data.role !== "OWNER"))
    redirect("/403");
  return response.data;
}
