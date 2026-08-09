"use client";

import { useState } from "react";
import { Icon } from "../../components/icons/icon";
import { Button } from "../../components/ui/button";
import { Field } from "../../components/ui/field";
import { Toast } from "../../components/ui/toast";
import { apiRequest } from "../../lib/api/browser-client";
import { requestIdFrom } from "../auth/form-security";

export function ContactEditor() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await apiRequest("/owner/contacts/invitations", {
        method: "POST",
        headers: { "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ displayName: name.normalize("NFC"), email }),
      });
      setName("");
      setEmail("");
      setMessage("邀请已进入可靠投递队列。联系人接受后仍需生成新分片代次。");
    } catch (error) {
      const requestId = requestIdFrom(error);
      setMessage(`邀请失败${requestId ? `。请求编号：${requestId}` : ""}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dls-editor">
      <Button onClick={() => setOpen((value) => !value)}>
        <Icon name="person_add" size={20} />
        {open ? "关闭邀请表单" : "邀请新联系人"}
      </Button>
      {open ? (
        <form className="dls-inline-form" onSubmit={submit}>
          <Field
            id="invite-name"
            label="联系人姓名"
            onChange={(event) => setName(event.target.value)}
            required
            value={name}
          />
          <Field
            id="invite-email"
            label="联系人邮箱"
            onChange={(event) => setEmail(event.target.value)}
            required
            type="email"
            value={email}
          />
          <Button busy={busy} type="submit">
            发送邀请
          </Button>
        </form>
      ) : null}
      {message ? (
        <Toast tone={message.startsWith("邀请已") ? "success" : "error"}>{message}</Toast>
      ) : null}
    </div>
  );
}
