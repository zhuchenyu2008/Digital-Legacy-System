import { EncryptedUpload } from "../../../features/vault/encrypted-upload";
import { PackageList, type PackageView } from "../../../features/vault/package-list";
import { serverApiRequest } from "../../../lib/api/server-client";

export default async function FilesPage() { const response = await serverApiRequest<readonly PackageView[]>("/owner/packages"); return <><div className="dls-page-heading"><h1>文件管理</h1><p>在浏览器内加密数字遗产 ZIP；新版本激活后才会替代旧版本。</p></div><EncryptedUpload /><PackageList packages={response.data ?? []} /></>; }
