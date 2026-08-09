import { StatusBadge } from "../../components/ui/status-badge";
import { formatBeijingDateTime } from "../../lib/time/beijing";

export type SystemHealthData = Readonly<{
  serverNow: string;
  categories: readonly Readonly<{
    code: "database" | "storage" | "worker" | "deadlineScanner" | "smtp";
    status: "ok" | "degraded" | "unknown";
    backend?: "local-volume" | "s3-compatible";
    lastSeenAt?: string | null;
  }>[];
  pendingJobs: number;
}>;

const categoryLabels = {
  database: "数据库",
  storage: "对象存储",
  worker: "后台工作进程",
  deadlineScanner: "截止时间扫描",
  smtp: "邮件投递",
} as const;

const statusLabels = { ok: "正常", degraded: "需关注", unknown: "未知" } as const;
const backendLabels = { "local-volume": "本地文件卷", "s3-compatible": "S3 兼容存储" } as const;

export function SystemHealth({ health }: Readonly<{ health: SystemHealthData }>) {
  return (
    <div className="dls-health-grid">
      <section className="dls-health-summary">
        <p className="dls-eyebrow">服务端时间 {formatBeijingDateTime(health.serverNow)}</p>
        <h2>运行状态分类</h2>
        <p>未知表示当前没有足够的持久化证据，不能视为正常。</p>
        <dl>
          <div>
            <dt>待处理任务</dt>
            <dd>{health.pendingJobs}</dd>
          </div>
        </dl>
      </section>
      <div className="dls-health-categories">
        {health.categories.map((category) => (
          <section key={category.code}>
            <div className="dls-section-heading">
              <h3>{categoryLabels[category.code]}</h3>
              <StatusBadge
                tone={
                  category.status === "ok"
                    ? "safe"
                    : category.status === "degraded"
                      ? "critical"
                      : "neutral"
                }
              >
                {statusLabels[category.status]}
              </StatusBadge>
            </div>
            {category.backend ? <p>后端：{backendLabels[category.backend]}</p> : null}
            <p>
              {category.lastSeenAt
                ? `最近证据：${formatBeijingDateTime(category.lastSeenAt)}`
                : "暂无可验证的最近证据"}
            </p>
          </section>
        ))}
      </div>
    </div>
  );
}
