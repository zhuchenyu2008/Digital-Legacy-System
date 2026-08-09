import { StatusBadge } from "../../components/ui/status-badge";

export type AuditIntegrityData = Readonly<{
  valid: boolean;
  entries: number;
  lastSequence: number;
  lastHash: string | null;
}>;

export function AuditIntegrity({ integrity }: Readonly<{ integrity: AuditIntegrityData }>) {
  return (
    <section className="dls-panel dls-audit-integrity" aria-labelledby="audit-integrity-title">
      <div className="dls-section-heading">
        <div>
          <p className="dls-eyebrow">完整性验证</p>
          <h2 id="audit-integrity-title">私有审计链</h2>
        </div>
        <StatusBadge tone={integrity.valid ? "safe" : "critical"}>
          {integrity.valid ? "链完整" : "验证失败"}
        </StatusBadge>
      </div>
      <dl className="dls-summary-list">
        <div>
          <dt>已验证事件</dt>
          <dd>{integrity.entries}</dd>
        </div>
        <div>
          <dt>最后序号</dt>
          <dd>{integrity.lastSequence}</dd>
        </div>
        <div>
          <dt>最后哈希</dt>
          <dd>
            <code>{integrity.lastHash ?? "无事件"}</code>
          </dd>
        </div>
      </dl>
    </section>
  );
}
