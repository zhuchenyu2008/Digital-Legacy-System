import Link from "next/link";
import { Icon } from "../../../components/icons/icon";
import { type OwnerSettingsView, SettingsForm } from "../../../features/settings/settings-form";
import { SmtpTest } from "../../../features/settings/smtp-test";
import { serverApiRequest } from "../../../lib/api/server-client";

const profileFields = [
  { icon: "user", label: "姓名", value: "由身份服务管理" },
  { icon: "mail", label: "主邮箱（用于身份验证）", value: "由身份服务管理" },
  { icon: "alternate_email", label: "备用邮箱", value: "未在当前设置接口公开" },
] as const;

export default async function SettingsPage() {
  const [settings, workflow] = await Promise.all([
    serverApiRequest<OwnerSettingsView>("/owner/settings"),
    serverApiRequest<{ state?: string }>("/owner/workflows/current"),
  ]);
  const value = settings.data ?? {
    missedDaysThreshold: 3,
    timezone: "Asia/Shanghai",
    settingsVersion: 0,
    smtp: { configured: false },
  };
  const locked = workflow.status === 200 && Boolean(workflow.data?.state);

  return (
    <div className="dls-settings-page">
      <div className="dls-page-heading">
        <h1>设置</h1>
        <p>
          <span className="dls-settings-mobile-copy">管理系统配置与安全策略</span>
          <span className="dls-settings-desktop-copy">
            管理系统参数与管理员信息。所有更改将在重新验证后生效。
          </span>
        </p>
      </div>

      <section className="dls-panel dls-settings-profile">
        <h2>
          <span className="dls-settings-mobile-copy">个人资料</span>
          <span className="dls-settings-desktop-copy">
            <Icon name="user" />
            管理员资料
          </span>
        </h2>
        <div className="dls-settings-mobile-profile">
          {profileFields.map((field) => (
            <div className="dls-settings-row" key={field.label}>
              <Icon name={field.icon} />
              <span>
                <strong>{field.label}</strong>
                <small>{field.value}</small>
              </span>
              <Icon name="chevron_right" size={20} />
            </div>
          ))}
        </div>
        <div className="dls-settings-profile-fields">
          {profileFields.map((field) => (
            <label key={field.label}>
              <span>{field.label}</span>
              <input disabled value={field.value} />
            </label>
          ))}
        </div>
        <div className="dls-settings-profile-action">
          <Link href="/admin/settings/password">修改主密码</Link>
        </div>
      </section>

      <div className="dls-settings-grid">
        <SettingsForm initial={value} workflowLocked={locked} />
        <SmtpTest configured={value.smtp.configured} />
      </div>

      <footer className="dls-settings-footer">
        <span>© 2026 Digital Legacy System. All rights reserved. Secure &amp; Immutable.</span>
        <nav aria-label="设置页脚">
          <Link href="/legal">Legal</Link>
          <Link href="/privacy">Privacy Policy</Link>
          <Link href="/admin/audit">Audit Log</Link>
        </nav>
      </footer>
    </div>
  );
}
