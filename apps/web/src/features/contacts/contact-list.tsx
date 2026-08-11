"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "../../components/icons/icon";
import { Button } from "../../components/ui/button";
import { Field } from "../../components/ui/field";
import { StatusBadge } from "../../components/ui/status-badge";
import { Toast } from "../../components/ui/toast";
import { apiRequest } from "../../lib/api/browser-client";
import { requestIdFrom } from "../auth/form-security";
import { removeContactWithReauth } from "./contact-rotation";

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
  const router = useRouter();
  const [removing, setRemoving] = useState<ContactView>();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  async function remove(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || removing === undefined) return;
    setBusy(true);
    try {
      await removeContactWithReauth(removing.id, password, { request: apiRequest });
      setMessage(`${removing.displayName} 已移除。重新邀请后必须生成新分片代次。`);
      setRemoving(undefined);
      setPassword("");
      router.refresh();
    } catch (error) {
      const requestId = requestIdFrom(error);
      setMessage(`移除联系人失败${requestId ? `。请求编号：${requestId}` : ""}`);
    } finally {
      setBusy(false);
    }
  }

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
                      onClick={() => {
                        setRemoving(contact);
                        setMessage(undefined);
                        setPassword("");
                      }}
                      title="重新认证后移除联系人"
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
      {removing ? (
        <form
          aria-label={`移除 ${removing.displayName}`}
          className="dls-inline-form"
          onSubmit={remove}
        >
          <p>
            移除 <strong>{removing.displayName}</strong> 后，系统将要求重新生成分片代次。
          </p>
          <Field
            autoComplete="current-password"
            id="remove-contact-owner-password"
            label="当前主密码"
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
          <Button busy={busy} type="submit">
            确认移除联系人
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              setRemoving(undefined);
              setPassword("");
            }}
            type="button"
            tone="secondary"
          >
            取消
          </Button>
        </form>
      ) : null}
      {message ? (
        <Toast tone={message.includes("已移除") ? "success" : "error"}>{message}</Toast>
      ) : null}
    </section>
  );
}
