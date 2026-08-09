import { Dashboard, type DashboardData } from "../../features/admin/dashboard";
import { serverApiRequest } from "../../lib/api/server-client";

export default async function AdminPage() {
  const [schedule, settings, workflow, contacts] = await Promise.all([serverApiRequest<Record<string, unknown>>("/owner/check-in-schedule"), serverApiRequest<Record<string, unknown>>("/owner/settings"), serverApiRequest<Record<string, unknown>>("/owner/workflows/current"), serverApiRequest<readonly Record<string, unknown>[]>("/owner/contacts")]);
  const rows = contacts.data ?? []; const activeContacts = rows.filter((row) => row.status === "ACTIVE").length;
  const data: DashboardData = { status: String((workflow.data?.state as string | undefined) ?? (settings.data ? "ARMED" : "SETUP")), lastCheckInAt: typeof schedule.data?.lastCheckInAt === "string" ? schedule.data.lastCheckInAt : null, nextDeadlineAt: typeof schedule.data?.nextDeadlineAt === "string" ? schedule.data.nextDeadlineAt : null, activeContacts, requiredContacts: 3, activePackageVersion: typeof settings.data?.activePackageVersion === "number" ? settings.data.activePackageVersion : null, auditEvents: [] };
  return <Dashboard data={data} />;
}
