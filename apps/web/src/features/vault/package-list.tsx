import { StatusBadge } from "../../components/ui/status-badge";
import { formatBeijingDateTime } from "../../lib/time/beijing";

export type PackageView = Readonly<{
  id: string;
  versionNo: number;
  status: string;
  ciphertextSha256: string;
  uploadedAt?: string | undefined;
  activatedAt?: string | undefined;
}>;
const labels: Record<string, string> = {
  ACTIVE: "当前有效",
  READY: "待激活",
  UPLOADING: "上传中",
  VERIFYING: "校验中",
  ABORTED: "已中止",
  SUPERSEDED: "历史版本",
};
export function PackageList({ packages }: Readonly<{ packages: readonly PackageView[] }>) {
  if (packages.length === 0)
    return (
      <section className="dls-panel">
        <h2>当前活动版本</h2>
        <p>尚未上传加密文件包。</p>
      </section>
    );
  const fallback = packages.at(0);
  if (fallback === undefined) return null;
  const active = packages.find((item) => item.status === "ACTIVE") ?? fallback;
  const history = packages.filter((item) => item.id !== active.id);
  return (
    <section className="dls-panel dls-package-list">
      <div className="dls-package-sidebar">
        <aside className="dls-package-summary">
          <div className="dls-section-heading">
            <span>当前有效版本</span>
            <span aria-hidden="true">◉</span>
          </div>
          <strong>V{active.versionNo}</strong>
          <dl>
            <div>
              <dt>上传时间</dt>
              <dd>
                {active.activatedAt || active.uploadedAt
                  ? formatBeijingDateTime(active.activatedAt ?? active.uploadedAt ?? "")
                  : "—"}
              </dd>
            </div>
            <div>
              <dt>SHA-256</dt>
              <dd>
                <code>{active.ciphertextSha256}</code>
              </dd>
            </div>
          </dl>
        </aside>
        <aside className="dls-package-verification">
          <h3>安全校验</h3>
          <p>
            <span aria-hidden="true">●</span>ZIP 格式验证 <strong>[PASS]</strong>
          </p>
          <p>
            <span aria-hidden="true">●</span>will.md 存在性 <strong>[PASS]</strong>
          </p>
          <p>
            <span aria-hidden="true">●</span>密钥分片状态 <strong>[READY]</strong>
          </p>
        </aside>
        <div className="dls-package-activation">
          <button disabled type="button">
            <span aria-hidden="true">⇧</span>激活新版本
          </button>
          <p>加密激活需输入主密码</p>
        </div>
      </div>
      <h2>历史版本记录</h2>
      <div className="dls-package-mobile">
        <h3>当前活动版本</h3>
        <dl>
          <div>
            <dt>版本号</dt>
            <dd>V{active.versionNo}</dd>
          </div>
          <div>
            <dt>更新时间</dt>
            <dd>
              {active.activatedAt || active.uploadedAt
                ? formatBeijingDateTime(active.activatedAt ?? active.uploadedAt ?? "")
                : "—"}
            </dd>
          </div>
          <div>
            <dt>SHA-256</dt>
            <dd>{active.ciphertextSha256}</dd>
          </div>
        </dl>
        {history.length > 0 ? (
          <>
            <h3>历史版本</h3>
            <ol>
              {history.map((item) => (
                <li key={item.id}>
                  <span aria-hidden="true">↶</span>
                  <div>
                    <strong>V{item.versionNo}</strong>
                    <small>
                      {item.activatedAt || item.uploadedAt
                        ? formatBeijingDateTime(item.activatedAt ?? item.uploadedAt ?? "")
                        : "—"}
                    </small>
                  </div>
                </li>
              ))}
            </ol>
          </>
        ) : null}
      </div>
      <div className="dls-table-wrap">
        <table className="dls-table">
          <thead>
            <tr>
              <th>版本号</th>
              <th>激活时间</th>
              <th>文件摘要（SHA-256）</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {packages.map((item) => (
              <tr key={item.id}>
                <td>
                  <strong>V{item.versionNo}</strong>
                </td>
                <td>
                  {item.activatedAt || item.uploadedAt
                    ? formatBeijingDateTime(item.activatedAt ?? item.uploadedAt ?? "")
                    : "—"}
                </td>
                <td>
                  <code>{item.ciphertextSha256}</code>
                </td>
                <td>
                  <StatusBadge
                    tone={
                      item.status === "ACTIVE"
                        ? "safe"
                        : item.status === "READY"
                          ? "warning"
                          : "neutral"
                    }
                  >
                    {labels[item.status] ?? item.status}
                  </StatusBadge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
