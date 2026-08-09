import { Icon } from "../../components/icons/icon";
import { StatusBadge } from "../../components/ui/status-badge";

export type ContactView = Readonly<{
  id: string;
  displayName: string;
  email: string;
  status: string;
  consentVersion?: string | undefined;
}>;
const labels: Record<string, string> = {
  ACTIVE: "已激活",
  INVITED: "待接受",
  PENDING_KEYING: "待分片",
  REVOKED: "已撤销",
  REMOVED: "已移除",
};

export function ContactList({ contacts }: Readonly<{ contacts: readonly ContactView[] }>) {
  if (contacts.length === 0)
    return (
      <section className="dls-panel">
        <h2>受信任网络</h2>
        <p>尚未邀请紧急联系人。</p>
      </section>
    );
  return (
    <section className="dls-contact-list">
      <div className="dls-section-heading">
        <h2>受信任网络</h2>
        <span>共 {contacts.length} 人</span>
      </div>
      <div className="dls-contact-cards">
        {contacts.map((contact) => (
          <article
            className={`dls-contact-card dls-contact-card--${contact.status.toLowerCase()}`}
            key={contact.id}
          >
            <span className="dls-contact-avatar" aria-hidden="true">
              {contact.displayName.slice(0, 1)}
            </span>
            <div>
              <div className="dls-contact-card-title">
                <strong>{contact.displayName}</strong>
                <StatusBadge
                  tone={
                    contact.status === "ACTIVE"
                      ? "safe"
                      : contact.status === "INVITED"
                        ? "warning"
                        : "neutral"
                  }
                >
                  {contact.status === "ACTIVE"
                    ? "ACTIVE"
                    : contact.status === "PENDING_KEYING"
                      ? "PENDING"
                      : (labels[contact.status] ?? contact.status)}
                </StatusBadge>
              </div>
              <span>{contact.email}</span>
            </div>
            <span className="dls-contact-menu" aria-hidden="true">
              ⋮
            </span>
          </article>
        ))}
      </div>
      <div className="dls-table-wrap">
        <table className="dls-table">
          <thead>
            <tr>
              <th>姓名与邮箱</th>
              <th>状态</th>
              <th>知情同意</th>
              <th className="dls-table-action-heading">操作</th>
            </tr>
          </thead>
          <tbody>
            {contacts.map((contact) => (
              <tr key={contact.id}>
                <td>
                  <strong>{contact.displayName}</strong>
                  <span>{contact.email}</span>
                </td>
                <td>
                  <StatusBadge
                    tone={
                      contact.status === "ACTIVE"
                        ? "safe"
                        : contact.status === "INVITED"
                          ? "warning"
                          : "neutral"
                    }
                  >
                    {labels[contact.status] ?? contact.status}
                  </StatusBadge>
                </td>
                <td>
                  <span className="dls-consent-version">
                    {contact.consentVersion ? `已签署（V${contact.consentVersion}）` : "待签署"}
                  </span>
                </td>
                <td>
                  <div className="dls-contact-actions">
                    <button
                      aria-label="重新发送联系人邀请"
                      disabled
                      title="联系人操作将在后续详情页开放"
                      type="button"
                    >
                      <Icon
                        name={contact.status === "PENDING_KEYING" ? "send" : "mail"}
                        size={20}
                      />
                    </button>
                    <button
                      aria-label="移除联系人"
                      disabled
                      title="联系人操作将在后续详情页开放"
                      type="button"
                    >
                      <Icon name="delete" size={20} />
                    </button>
                    <span className="dls-sr-only">
                      {contact.status === "PENDING_KEYING"
                        ? "需要重新生成并激活分片代次"
                        : "联系人操作需要管理员重新认证"}
                    </span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
