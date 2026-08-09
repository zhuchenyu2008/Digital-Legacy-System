import { StatusBadge } from "../../components/ui/status-badge";
import { formatBeijingDateTime } from "../../lib/time/beijing";

export type PackageView = Readonly<{ id: string; versionNo: number; status: string; ciphertextSha256: string; uploadedAt?: string | undefined; activatedAt?: string | undefined }>;
const labels: Record<string, string> = { ACTIVE: "当前有效", READY: "待激活", UPLOADING: "上传中", VERIFYING: "校验中", ABORTED: "已中止", SUPERSEDED: "历史版本" };
export function PackageList({ packages }: Readonly<{ packages: readonly PackageView[] }>) {
  if (packages.length === 0) return <section className="dls-panel"><h2>当前活动版本</h2><p>尚未上传加密文件包。</p></section>;
  return <section className="dls-panel"><h2>版本记录</h2><div className="dls-table-wrap"><table className="dls-table"><thead><tr><th>版本</th><th>状态</th><th>时间</th><th>SHA-256</th></tr></thead><tbody>{packages.map((item) => <tr key={item.id}><td><strong>V{item.versionNo}</strong></td><td><StatusBadge tone={item.status === "ACTIVE" ? "safe" : item.status === "READY" ? "warning" : "neutral"}>{labels[item.status] ?? item.status}</StatusBadge></td><td>{item.activatedAt || item.uploadedAt ? formatBeijingDateTime(item.activatedAt ?? item.uploadedAt ?? "") : "—"}</td><td><code>{item.ciphertextSha256}</code></td></tr>)}</tbody></table></div></section>;
}
