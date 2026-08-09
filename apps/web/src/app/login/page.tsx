import { redirect } from "next/navigation";
import { AuthFrame } from "../../features/auth/auth-frame";
import { OwnerLoginForm } from "../../features/auth/owner-login-form";
import { serverApiRequest } from "../../lib/api/server-client";

export default async function LoginPage() {
  const session = await serverApiRequest("/auth/session");
  if (session.status === 200) redirect("/admin");
  return (
    <AuthFrame
      description="登录成功会同时记录一次北京时间自然日签到，并刷新系统截止时间。"
      title="管理员登录"
    >
      <OwnerLoginForm />
    </AuthFrame>
  );
}
