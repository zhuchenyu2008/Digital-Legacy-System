"use client";

import { useState } from "react";
import { Button } from "../../components/ui/button";
import { apiRequest } from "../../lib/api/browser-client";
import { formatBeijingDateTime } from "../../lib/time/beijing";

export type PrivateAuditEvent = Readonly<{
  sequence: number;
  eventId: string;
  occurredAt: string;
  eventType: string;
  actorType: string;
  targetType?: string;
  targetId?: string;
  result: string;
  requestId?: string;
  eventHash: string;
}>;

export type PrivateAuditPage = Readonly<{
  items: readonly PrivateAuditEvent[];
  nextCursor: string | null;
}>;

type AuditDetail = PrivateAuditEvent &
  Readonly<{
    metadataDigest: string | null;
    ipDigest: string | null;
    userAgentDigest: string | null;
  }>;

const eventLabels: Readonly<Record<string, string>> = {
  OWNER_LOGIN: "管理员登录",
  OWNER_LOGIN_CHECKIN: "管理员登录并签到",
  CHECKIN_EVALUATED: "签到截止评估",
  DEATH_WORKFLOW_STARTED: "死亡确认流程启动",
  WORKFLOW_ADVANCED: "工作流推进",
};

export function PrivateAuditList({ initial }: Readonly<{ initial: PrivateAuditPage }>) {
  const [page, setPage] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [detailEventId, setDetailEventId] = useState<string>();
  const [password, setPassword] = useState("");
  const [detail, setDetail] = useState<AuditDetail>();
  const [message, setMessage] = useState<string>();

  async function loadMore() {
    if (page.nextCursor === null) return;
    setLoading(true);
    setMessage(undefined);
    try {
      const next = await apiRequest<PrivateAuditPage>(
        `/owner/audit-events?cursor=${encodeURIComponent(page.nextCursor)}&limit=20`,
      );
      setPage({ items: [...page.items, ...next.items], nextCursor: next.nextCursor });
    } catch {
      setMessage("暂时无法加载更多审计事件，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }

  async function readDetail() {
    if (detailEventId === undefined || password.length === 0) return;
    setLoading(true);
    setMessage(undefined);
    try {
      setDetail(
        await apiRequest<AuditDetail>(`/owner/audit-events/${detailEventId}/detail`, {
          method: "POST",
          body: JSON.stringify({ password }),
        }),
      );
      setDetailEventId(undefined);
    } catch {
      setMessage("重新验证失败，未显示审计详情。");
    } finally {
      setPassword("");
      setLoading(false);
    }
  }

  return (
    <section className="dls-audit-events" aria-labelledby="audit-events-title">
      <div className="dls-section-heading">
        <div>
          <p className="dls-eyebrow">仅显示允许字段</p>
          <h2 id="audit-events-title">审计事件</h2>
        </div>
        <span>{page.items.length} 项</span>
      </div>
      {message ? (
        <p className="dls-form-note" role="status">
          {message}
        </p>
      ) : null}
      <div className="dls-table-wrap">
        <table className="dls-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>事件</th>
              <th>结果</th>
              <th>目标</th>
              <th>验证</th>
            </tr>
          </thead>
          <tbody>
            {page.items.map((event) => (
              <tr key={event.eventId}>
                <td>
                  <time>{formatBeijingDateTime(event.occurredAt)}</time>
                  <span>序号 {event.sequence}</span>
                </td>
                <td>
                  <strong>{eventLabels[event.eventType] ?? event.eventType}</strong>
                  <code>{event.eventId}</code>
                </td>
                <td>{event.result}</td>
                <td>
                  {event.targetType ?? "系统"}
                  <code>{event.targetId ?? "-"}</code>
                </td>
                <td>
                  <Button
                    onClick={() => {
                      setDetailEventId(event.eventId);
                      setDetail(undefined);
                    }}
                    tone="secondary"
                  >
                    重新验证
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {detailEventId ? (
        <div className="dls-audit-reauth">
          <label htmlFor="audit-password">输入主密码后查看该事件的密文摘要</label>
          <input
            autoComplete="current-password"
            className="dls-input"
            id="audit-password"
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            value={password}
          />
          <div className="dls-action-row">
            <Button
              onClick={() => {
                setDetailEventId(undefined);
                setPassword("");
              }}
              tone="quiet"
            >
              取消
            </Button>
            <Button busy={loading} disabled={password.length === 0} onClick={readDetail}>
              验证并查看
            </Button>
          </div>
        </div>
      ) : null}
      {detail ? (
        <div className="dls-panel dls-audit-detail" aria-live="polite">
          <h3>审计密文摘要</h3>
          <p>以下值仅用于比对完整性，不包含 IP、浏览器信息或事件元数据明文。</p>
          <dl className="dls-summary-list">
            <div>
              <dt>元数据摘要</dt>
              <dd>
                <code>{detail.metadataDigest ?? "无"}</code>
              </dd>
            </div>
            <div>
              <dt>网络来源摘要</dt>
              <dd>
                <code>{detail.ipDigest ?? "无"}</code>
              </dd>
            </div>
            <div>
              <dt>客户端摘要</dt>
              <dd>
                <code>{detail.userAgentDigest ?? "无"}</code>
              </dd>
            </div>
          </dl>
        </div>
      ) : null}
      {page.nextCursor ? (
        <Button busy={loading} onClick={loadMore} tone="secondary">
          加载更早事件
        </Button>
      ) : (
        <p className="dls-form-note">已到达审计链起点。</p>
      )}
    </section>
  );
}
