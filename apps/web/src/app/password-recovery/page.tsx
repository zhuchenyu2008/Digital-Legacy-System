import { AuthFrame } from "../../features/auth/auth-frame";
import { RecoveryFlow } from "../../features/recovery/recovery-flow";

export default function PasswordRecoveryPage() {
  return (
    <AuthFrame
      description="恢复流程需要主邮箱入口、联系人门限审批、8 位邮箱验证码和一次性浏览器密钥。"
      title="恢复主密码"
    >
      <RecoveryFlow />
    </AuthFrame>
  );
}
