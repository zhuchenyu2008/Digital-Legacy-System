import Link from "next/link";
import { Icon } from "../../components/icons/icon";
import { StatusBadge } from "../../components/ui/status-badge";
import { formatBeijingDateTime } from "../../lib/time/beijing";
import { ArmingChecklist } from "./arming-checklist";
import { OwnerCheckInForm } from "./owner-check-in-form";

export type DashboardData = Readonly<{
  status: string;
  lastCheckInAt: string | null;
  nextDeadlineAt: string | null;
  serverNow?: string;
  activeContacts: number;
  requiredContacts: number;
  activePackageVersion: number | null;
  auditEvents: readonly Readonly<{ id: string; occurredAt: string; summary: string }>[];
}>;

function shortTime(value: string): string {
  return formatBeijingDateTime(value).replace(/:\d{2}（北京时间）$/u, "");
}

function auditTime(value: string): string {
  return formatBeijingDateTime(value).replace("（北京时间）", "");
}

function AccessibleTime({ value, visible }: Readonly<{ value: string; visible: string }>) {
  return (
    <time dateTime={value}>
      <span aria-hidden="true">{visible}</span>
      <span className="dls-sr-only">{formatBeijingDateTime(value)}</span>
    </time>
  );
}

export function Dashboard({ data }: Readonly<{ data: DashboardData }>) {
  const baseline = data.serverNow ?? data.lastCheckInAt;
  const hours =
    baseline && data.nextDeadlineAt
      ? Math.max(0, Math.ceil((Date.parse(data.nextDeadlineAt) - Date.parse(baseline)) / 3_600_000))
      : 0;
  const armed = data.status === "ARMED";

  return (
    <div className={`dls-dashboard${armed ? " dls-dashboard--armed" : ""}`}>
      <section className="dls-dashboard-mobile-checkin">
        <div aria-hidden="true" className="dls-dashboard-mobile-rings">
          <i />
          <i />
        </div>
        <span className="dls-mono">SYSTEM COUNTDOWN</span>
        <div className="dls-dashboard-mobile-countdown">
          <small>距离截止时间还有</small>
          <strong>
            {hours}
            <em>小时</em>
          </strong>
        </div>
        <OwnerCheckInForm variant="mobile" />
        <p>完成签到以确认您的存活状态，并重置系统的数字遗产执行倒计时。</p>
      </section>

      <div className="dls-page-heading">
        <StatusBadge tone={armed ? "safe" : "neutral"}>{data.status}</StatusBadge>
        <h1>管理员首页</h1>
        <p>查看签到截止时间、启用条件和最近审计事件。</p>
      </div>

      <div className="dls-dashboard-grid">
        <section className="dls-panel dls-system-status dls-dashboard-primary">
          <div className="dls-section-heading">
            <h2>系统状态</h2>
            <span className={`dls-dashboard-state${armed ? " is-armed" : ""}`}>
              <Icon filled name="shield" size={22} />
              {data.status}
            </span>
          </div>
          <dl className="dls-metric-row">
            <div>
              <dt>最后签到</dt>
              <dd>
                {data.lastCheckInAt ? (
                  <AccessibleTime
                    value={data.lastCheckInAt}
                    visible={shortTime(data.lastCheckInAt)}
                  />
                ) : (
                  "尚无签到记录"
                )}
              </dd>
            </div>
            <div>
              <dt>下次截止</dt>
              <dd>
                {data.nextDeadlineAt ? (
                  <AccessibleTime
                    value={data.nextDeadlineAt}
                    visible={shortTime(data.nextDeadlineAt)}
                  />
                ) : (
                  "尚未生成截止时间"
                )}
              </dd>
            </div>
          </dl>
          <div className="dls-dashboard-countdown">
            <span>距离截止时间还有</span>
            <strong>
              {hours}
              <em>小时</em>
            </strong>
          </div>
          <OwnerCheckInForm />
        </section>

        <div className="dls-dashboard-sidebar">
          <aside className="dls-panel dls-dashboard-overview">
            <h2>系统概况</h2>
            <dl className="dls-summary-list">
              <div>
                <dt>
                  <Icon name="contacts" size={20} />
                  有效联系人
                </dt>
                <dd>
                  {data.activeContacts} / {data.requiredContacts}
                </dd>
              </div>
              <div>
                <dt>
                  <Icon name="folder" size={20} />
                  当前文件版本
                </dt>
                <dd>
                  {data.activePackageVersion === null ? "未激活" : `V${data.activePackageVersion}`}
                </dd>
              </div>
            </dl>
          </aside>
          <section className="dls-panel dls-dashboard-audit">
            <div className="dls-section-heading">
              <h2>审计日志</h2>
              <Link href="/admin/audit">查看全部</Link>
            </div>
            {data.auditEvents.length === 0 ? (
              <p>暂无可显示的审计事件。</p>
            ) : (
              <ol className="dls-dashboard-timeline">
                {data.auditEvents.map((event, index) => (
                  <li data-current={index === 0} key={event.id}>
                    <AccessibleTime
                      value={event.occurredAt}
                      visible={auditTime(event.occurredAt)}
                    />
                    <span>{event.summary}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </div>

      {!armed ? (
        <ArmingChecklist
          activeContacts={data.activeContacts}
          activePackageVersion={data.activePackageVersion}
          requiredContacts={data.requiredContacts}
        />
      ) : null}
    </div>
  );
}
