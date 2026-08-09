import { AuthFrame } from "../../../features/auth/auth-frame";
import { ContactPasswordChange } from "../../../features/contacts/contact-password-change";

export default function ContactPasswordChangePage() {
  return <AuthFrame description="修改密码只会在浏览器内重新包装联系人私钥，历史分片无需重新生成。" title="修改联系人密码"><ContactPasswordChange /></AuthFrame>;
}
