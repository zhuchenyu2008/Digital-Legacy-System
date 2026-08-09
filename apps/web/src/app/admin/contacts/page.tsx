import { ContactEditor } from "../../../features/contacts/contact-editor";
import { ContactList, type ContactView } from "../../../features/contacts/contact-list";
import { ShareGenerationWizard } from "../../../features/contacts/share-generation-wizard";
import { serverApiRequest } from "../../../lib/api/server-client";

export default async function ContactsPage() { const response = await serverApiRequest<readonly ContactView[]>("/owner/contacts"); const contacts = response.data ?? []; return <><div className="dls-page-heading"><h1>紧急联系人管理</h1><p>配置数字遗产继承人与信任网络。联系人彼此不可见。</p></div><ContactEditor /><ShareGenerationWizard needsRegeneration={contacts.some((item) => item.status === "PENDING_KEYING")} /><ContactList contacts={contacts} /></>; }
