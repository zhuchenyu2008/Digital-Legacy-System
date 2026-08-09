import { StatusBadge } from "../../components/ui/status-badge";

export type ContactView = Readonly<{ id: string; displayName: string; email: string; status: string; consentVersion?: string | undefined }>;
const labels: Record<string, string> = { ACTIVE: "已激活", INVITED: "待接受", PENDING_KEYING: "待分片", REVOKED: "已撤销", REMOVED: "已移除" };

export function ContactList({ contacts }: Readonly<{ contacts: readonly ContactView[] }>) {
  if (contacts.length === 0) return <section className="dls-panel"><h2>受信任网络</h2><p>尚未邀请紧急联系人。</p></section>;
  return <section><div className="dls-section-heading"><h2>受信任网络</h2><span>共 {contacts.length} 人</span></div><div className="dls-table-wrap"><table className="dls-table"><thead><tr><th>姓名与邮箱</th><th>状态</th><th>知情同意</th><th>说明</th></tr></thead><tbody>{contacts.map((contact) => <tr key={contact.id}><td><strong>{contact.displayName}</strong><span>{contact.email}</span></td><td><StatusBadge tone={contact.status === "ACTIVE" ? "safe" : contact.status === "INVITED" ? "warning" : "neutral"}>{labels[contact.status] ?? contact.status}</StatusBadge></td><td>{contact.consentVersion ? `已签署（V${contact.consentVersion}）` : "待签署"}</td><td>{contact.status === "PENDING_KEYING" ? "需要重新生成并激活分片代次" : "—"}</td></tr>)}</tbody></table></div></section>;
}
