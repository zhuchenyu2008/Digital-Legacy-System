import { Dashboard, type DashboardData } from "../../features/admin/dashboard";
import { serverApiRequest } from "../../lib/api/server-client";

type AuditResponse = Readonly<{
  items?: readonly Readonly<{
    eventId?: string;
    sequence?: number;
    occurredAt?: string;
    eventType?: string;
  }>[];
}>;

const auditLabels: Readonly<Record<string, string>> = {
  OWNER_LOGIN_CHECKIN: "管理员成功签到",
  OWNER_EXPLICIT_CHECKIN: "管理员成功签到",
  VAULT_PACKAGE_ACTIVATED: "更新加密文档包",
  SHARE_GENERATION_ACTIVATED: "联系人配置验证通过",
};

export default async function AdminPage() {
  const [schedule, settings, workflow, contacts, audit] = await Promise.all([
    serverApiRequest<Record<string, unknown>>("/owner/check-in-schedule"),
    serverApiRequest<Record<string, unknown>>("/owner/settings"),
    serverApiRequest<Record<string, unknown>>("/owner/workflows/current"),
    serverApiRequest<readonly Record<string, unknown>[]>("/owner/contacts"),
    serverApiRequest<AuditResponse>("/owner/audit-events?limit=3"),
  ]);
  const rows = contacts.data ?? [];
  const activeContacts = rows.filter((row) => row.status === "ACTIVE").length;
  const events = audit.data?.items ?? [];
  const data: DashboardData = {
    status: String(
      (workflow.data?.state as string | undefined) ?? (settings.data ? "ARMED" : "SETUP"),
    ),
    lastCheckInAt:
      typeof schedule.data?.lastCheckInAt === "string" ? schedule.data.lastCheckInAt : null,
    nextDeadlineAt:
      typeof schedule.data?.deadlineAt === "string"
        ? schedule.data.deadlineAt
        : typeof schedule.data?.nextDeadlineAt === "string"
          ? schedule.data.nextDeadlineAt
          : null,
    serverNow: new Date().toISOString(),
    activeContacts,
    requiredContacts: 3,
    activePackageVersion:
      typeof settings.data?.activePackageVersion === "number"
        ? settings.data.activePackageVersion
        : null,
    auditEvents: events.flatMap((event, index) =>
      typeof event.occurredAt === "string"
        ? [
            {
              id: event.eventId ?? String(event.sequence ?? index),
              occurredAt: event.occurredAt,
              summary: auditLabels[event.eventType ?? ""] ?? "系统安全事件",
            },
          ]
        : [],
    ),
  };
  return <Dashboard data={data} />;
}
