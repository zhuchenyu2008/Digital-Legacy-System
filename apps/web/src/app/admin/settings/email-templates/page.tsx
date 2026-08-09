import { EmailTemplateEditor } from "../../../../features/settings/email-template-editor";
const codes = ["CONTACT_INVITATION", "CHECKIN_REMINDER", "DEATH_CONFIRMATION_REQUEST", "DEATH_CANCELLED_BY_CONTACT", "DEATH_CANCELLED_BY_OWNER", "DEATH_STAGE2_REMINDER", "LEGACY_RELEASED", "CONTACT_PASSWORD_CHANGE", "OWNER_RECOVERY_START", "OWNER_RECOVERY_CONTACT_REQUEST", "OWNER_PASSWORD_RESET"] as const;
export default function EmailTemplatesPage() { return <><div className="dls-page-heading"><h1>邮件模板</h1><p>预览使用声明的合成数据，不发送邮件、不缓存结果。</p></div><EmailTemplateEditor codes={codes} /></>; }
