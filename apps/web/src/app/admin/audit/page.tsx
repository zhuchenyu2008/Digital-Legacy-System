import { AuditIntegrity, type AuditIntegrityData } from "../../../features/audit/audit-integrity";
import {
  PrivateAuditList,
  type PrivateAuditPage,
} from "../../../features/audit/private-audit-list";
import { SupportErrorState } from "../../../features/support/support-error-state";
import { serverApiRequest } from "../../../lib/api/server-client";

export default async function AuditPage() {
  const [events, integrity] = await Promise.all([
    serverApiRequest<PrivateAuditPage>("/owner/audit-events?limit=20"),
    serverApiRequest<AuditIntegrityData>("/owner/audit-integrity"),
  ]);
  if (events.data === undefined || integrity.data === undefined) {
    return <SupportErrorState code="error" />;
  }
  return (
    <div className="dls-operational-page">
      <div className="dls-page-heading">
        <p className="dls-eyebrow">不可变操作记录</p>
        <h1>私有审计</h1>
        <p>验证哈希链并查看经过最小化投影的安全事件。事件详情需要重新输入主密码。</p>
      </div>
      <AuditIntegrity integrity={integrity.data} />
      <PrivateAuditList initial={events.data} />
    </div>
  );
}
