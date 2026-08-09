import { Icon } from "../../../components/icons/icon";
import { StatusBadge } from "../../../components/ui/status-badge";
import { EncryptedUpload } from "../../../features/vault/encrypted-upload";
import { PackageList, type PackageView } from "../../../features/vault/package-list";
import { serverApiRequest } from "../../../lib/api/server-client";

export default async function FilesPage() {
  const response = await serverApiRequest<readonly PackageView[]>("/owner/packages");

  return (
    <div className="dls-files-page">
      <div className="dls-page-heading">
        <h1>
          文件管理
          <span className="dls-file-title-status">
            <StatusBadge tone="safe">ARMED</StatusBadge>
          </span>
        </h1>
        <p>加密存储您的数字遗产 ZIP 包，并预览 will.md 正文。</p>
      </div>
      <section className="dls-encryption-ready">
        <Icon filled name="lock" size={20} />
        <div>
          <strong>浏览器端加密已就绪</strong>
          <p>所有文件将在本地分块加密，仅密文上传至服务器。</p>
        </div>
      </section>
      <EncryptedUpload />
      <section className="dls-will-preview">
        <div>
          <strong>will.md 预览</strong>
        </div>
        <p>
          <Icon name="description" size={22} />
          待上传 will.md 预览区
        </p>
      </section>
      <div className="dls-file-assurances">
        <span>
          <Icon filled name="lock" size={28} />
          <strong>AES-256 加密</strong>
        </span>
        <span>
          <Icon name="visibility" size={28} />
          <strong>预览 will.md</strong>
        </span>
      </div>
      <PackageList packages={response.data ?? []} />
    </div>
  );
}
