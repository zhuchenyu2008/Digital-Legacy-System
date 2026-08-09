import { AuthFrame } from "../../../features/auth/auth-frame";
import { ContactLoginForm } from "../../../features/auth/contact-login-form";

export default function ContactLoginPage() {
  return (
    <AuthFrame
      description="联系人只能读取自己的密钥材料和当前可参与流程；系统不会展示其他联系人身份。"
      title="联系人登录"
    >
      <ContactLoginForm />
    </AuthFrame>
  );
}
