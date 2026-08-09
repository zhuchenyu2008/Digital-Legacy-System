import { Icon } from "../../components/icons/icon";
import { formatBeijingDateTime } from "../../lib/time/beijing";
import { CopyPublicWill } from "./copy-public-will";
import { DownloadPackage } from "./download-package";
import { PublicAudit, type PublicAuditEvent } from "./public-audit";

export type PublicationView = Readonly<{
  ownerDisplayName: string;
  publishedAt: string;
  willHtml: string;
  packageBytes: number;
  packageSha256: string;
  auditRootHash: string;
  auditEvents?: readonly PublicAuditEvent[] | undefined;
}>;

export function LegacyPage({ publication }: Readonly<{ publication: PublicationView }>) {
  return (
    <main className="dls-legacy">
      <div className="dls-legacy-topbar">
        <div className="dls-legacy-brand">
          <strong>Digital Legacy</strong>
          <span className="dls-release-badge">RELEASED / 已发布</span>
        </div>
        <span className="dls-public-node">
          <Icon name="security" size={18} />
          Authenticated Public Node
        </span>
      </div>

      <div className="dls-legacy-content">
        <header className="dls-legacy-hero">
          <p className="dls-robots">
            <Icon name="public" size={16} />
            <span>X-ROBOTS-TAG: NOINDEX, NOFOLLOW</span>
          </p>
          <div className="dls-legacy-title-row">
            <h1>数字遗产公开遗书</h1>
            <span className="dls-release-badge dls-release-badge--mobile">RELEASED / 已发布</span>
          </div>
          <p className="dls-legacy-intro">
            <strong>{publication.ownerDisplayName}</strong> 的数字遗产已于{" "}
            <time>{formatBeijingDateTime(publication.publishedAt)}</time>{" "}
            正式发布。根据既定协议，此文档及其关联文件自正式发布时起不可篡改，并可通过公开摘要进行独立验证。
          </p>
        </header>

        <article className="dls-will">
          <div className="dls-will-heading">
            <span className="dls-will-file">
              <Icon name="description" size={22} />
              <strong>will.md</strong>
            </span>
            <CopyPublicWill />
          </div>
          <div
            className="dls-will-body"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: publication.willHtml is allowlist-sanitized before immutable storage and the public API only serves that sanitized column.
            dangerouslySetInnerHTML={{ __html: publication.willHtml }}
          />
        </article>

        <div className="dls-legacy-grid">
          <DownloadPackage bytes={publication.packageBytes} sha256={publication.packageSha256} />
          <PublicAudit events={publication.auditEvents ?? []} />
        </div>

        <section className="dls-download-box dls-public-verification">
          <h2>发布验证</h2>
          <span className="dls-public-verification-label">公开审计根哈希</span>
          <code>{publication.auditRootHash}</code>
          <p>可将 ZIP 摘要与独立下载结果核对。</p>
        </section>
      </div>
    </main>
  );
}
