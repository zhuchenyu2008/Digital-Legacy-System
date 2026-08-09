import { ContactEditor } from "../../../features/contacts/contact-editor";
import { ContactList, type ContactView } from "../../../features/contacts/contact-list";
import { ShareGenerationWizard } from "../../../features/contacts/share-generation-wizard";
import { serverApiRequest } from "../../../lib/api/server-client";

export default async function ContactsPage() {
  const response = await serverApiRequest<readonly ContactView[]>("/owner/contacts");
  const contacts = response.data ?? [];
  const effective = contacts.filter(
    (item) => item.status === "ACTIVE" || item.status === "PENDING_KEYING",
  ).length;
  const deathThreshold = Math.max(2, Math.ceil(effective * 0.7));
  const recoveryThreshold = Math.max(2, Math.floor(effective / 2) + 1);
  return (
    <div className="dls-contacts-page">
      <div className="dls-page-heading">
        <h1>
          <span className="dls-mobile-title">联系人管理</span>
          <span className="dls-desktop-title">紧急联系人管理</span>
        </h1>
        <p>配置您的数字遗产继承人及信任网络。</p>
      </div>
      <section className="dls-contact-threshold" aria-label="法定触发阈值">
        <div className="dls-section-heading">
          <div>
            <h2>法定触发阈值</h2>
            <p>需要多方确认以解锁遗产</p>
          </div>
          <span className="dls-status dls-status--safe">
            <span aria-hidden="true">●</span>ARMED
          </span>
        </div>
        <dl>
          <div>
            <dt>
              总有效人数<small>最少 3 人</small>
            </dt>
            <dd>{effective}</dd>
          </div>
          <div>
            <dt>
              死亡确认门限<small>门限：{deathThreshold}（70%）</small>
            </dt>
            <dd>{deathThreshold}</dd>
          </div>
          <div>
            <dt>
              密码恢复门限<small>门限：{recoveryThreshold}（50%+1）</small>
            </dt>
            <dd>{recoveryThreshold}</dd>
          </div>
        </dl>
      </section>
      <section className="dls-contact-guidance" aria-label="联系人隐私与分片说明">
        <p>联系人彼此不可见。他们无法查看名单上的其他人。</p>
        <p>
          <span>待分片</span> 状态的联系人在您使用主密码重新分片前不计入门限。
        </p>
        <p>
          至少需要 3 名有效联系人以维持 <strong>ARMED</strong> 状态。
        </p>
      </section>
      <ShareGenerationWizard
        needsRegeneration={contacts.some((item) => item.status === "PENDING_KEYING")}
      />
      <div className="dls-contact-network">
        <ContactList contacts={contacts} />
        <ContactEditor />
      </div>
    </div>
  );
}
