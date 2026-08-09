import { redirect } from "next/navigation";
import { serverApiRequest } from "../api/server-client.js";

export async function requireContact(): Promise<void> {
  const response = await serverApiRequest("/contact/workflows/current");
  if (response.status === 401) redirect("/contact/login");
  if (response.status === 403) redirect("/403");
}
