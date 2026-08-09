import { SystemHealth, type SystemHealthData } from "../../../features/health/system-health";
import { SupportErrorState } from "../../../features/support/support-error-state";
import { serverApiRequest } from "../../../lib/api/server-client";

export default async function HealthPage() {
  const response = await serverApiRequest<SystemHealthData>("/owner/system-health");
  if (response.data === undefined) return <SupportErrorState code="error" />;
  return (
    <div className="dls-operational-page">
      <div className="dls-page-heading">
        <p className="dls-eyebrow">安全运维视图</p>
        <h1>系统健康</h1>
        <p>仅显示分类状态和持久化证据，不返回服务地址、文件路径、凭据或原始提供商错误。</p>
      </div>
      <SystemHealth health={response.data} />
    </div>
  );
}
