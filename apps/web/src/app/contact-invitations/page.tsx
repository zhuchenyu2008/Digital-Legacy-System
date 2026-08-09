import { AuthFrame } from "../../features/auth/auth-frame";
import { InvitationAcceptance } from "../../features/contacts/invitation-acceptance";

export default function ContactInvitationsPage() {
  return (
    <AuthFrame
      description="请完整阅读知情同意书。邀请令牌会从地址片段读取并立即从浏览器历史中清除。"
      title="接受紧急联系人邀请"
    >
      <InvitationAcceptance />
    </AuthFrame>
  );
}
