import { redirect } from "next/navigation";
import { AuthFrame } from "../../features/auth/auth-frame";
import { SetupForm } from "../../features/setup/setup-form";
import { serverApiRequest } from "../../lib/api/server-client";

export default async function SetupPage() {
  const status = await serverApiRequest<{ initialized?: boolean }>("/setup/status");
  if (status.data?.initialized) redirect("/login");
  return <AuthFrame description="在本机浏览器中生成保险库根密钥，并创建唯一管理员。敏感材料不会进入服务端渲染内容。" title="初始化数字遗产系统"><SetupForm /></AuthFrame>;
}
