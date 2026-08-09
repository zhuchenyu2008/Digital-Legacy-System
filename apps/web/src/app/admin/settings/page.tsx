import Link from "next/link";
import { SettingsForm, type OwnerSettingsView } from "../../../features/settings/settings-form";
import { SmtpTest } from "../../../features/settings/smtp-test";
import { serverApiRequest } from "../../../lib/api/server-client";

export default async function SettingsPage() { const [settings, workflow] = await Promise.all([serverApiRequest<OwnerSettingsView>("/owner/settings"), serverApiRequest<{ state?: string }>("/owner/workflows/current")]); const value = settings.data ?? { missedDaysThreshold: 3, timezone: "Asia/Shanghai", settingsVersion: 0, smtp: { configured: false } }; const locked = workflow.status === 200 && Boolean(workflow.data?.state); return <><div className="dls-page-heading"><h1>设置</h1><p>管理系统参数。所有写入都要求主密码重新认证。</p></div><div className="dls-settings-grid"><SettingsForm initial={value} workflowLocked={locked} /><SmtpTest configured={value.smtp.configured} /><section className="dls-panel"><h2>安全与模板</h2><div className="dls-link-list"><Link href="/admin/settings/password">修改主密码</Link><Link href="/admin/settings/email-templates">邮件模板预览</Link><Link href="/admin/audit">查看不可篡改审计</Link></div></section></div></>; }
