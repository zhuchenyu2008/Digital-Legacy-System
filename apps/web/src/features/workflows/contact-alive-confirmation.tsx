"use client";

import { useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { Field } from "../../components/ui/field";
import { Toast } from "../../components/ui/toast";
import { apiRequest } from "../../lib/api/browser-client";
import { requestIdFrom } from "../auth/form-security";
import {
  aliveConfirmationText,
  ConfirmationText,
  exactConfirmationMatches,
} from "./confirmation-text";
import type { ContactActionDialogProps } from "./contact-workflow-types";

export function ContactAliveConfirmation({
  open,
  workflow,
  onCancel,
  onComplete,
}: ContactActionDialogProps) {
  const target = aliveConfirmationText(workflow.ownerDisplayName);
  const [password, setPassword] = useState("");
  const [confirmationText, setConfirmationText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const submitting = useRef(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || !password || !exactConfirmationMatches(confirmationText, target))
      return;
    submitting.current = true;
    setBusy(true);
    setMessage(undefined);
    try {
      await apiRequest(
        `/contact/workflows/${encodeURIComponent(workflow.workflowId)}/confirm-alive`,
        {
          method: "POST",
          body: JSON.stringify({ password, confirmationText }),
        },
      );
      setConfirmationText("");
      onComplete({ state: "CLOSED", message: "已确认管理员仍然健在，本次确认流程已经终止。" });
    } catch (error) {
      const status =
        typeof error === "object" && error !== null && "status" in error
          ? Number((error as { status: unknown }).status)
          : 0;
      const requestId = requestIdFrom(error);
      setMessage(
        status === 401
          ? "联系人密码验证失败，请重新输入。"
          : status === 409
            ? "此流程已关闭或你已经作出决定。"
            : `提交失败，请稍后重试${requestId ? `。请求编号：${requestId}` : ""}`,
      );
    } finally {
      setPassword("");
      setBusy(false);
      submitting.current = false;
    }
  }

  return (
    <Dialog
      description="此决定会立即终止死亡确认流程并重新安排管理员签到。"
      {...(busy ? {} : { onClose: onCancel })}
      open={open}
      title="确认：仍然健在"
    >
      <form className="dls-form-stack" onSubmit={submit}>
        <div className="dls-disclosure-warning" role="note">
          选择“仍然健在”会向管理员披露本次工作流快照中的联系人姓名，以便说明是谁终止了流程。
        </div>
        <ConfirmationText
          id="alive-confirmation-text"
          onChange={setConfirmationText}
          target={target}
          value={confirmationText}
        />
        <Field
          autoComplete="current-password"
          id="alive-contact-password"
          label="联系人密码（允许密码管理器填充或粘贴）"
          onChange={(event) => setPassword(event.target.value)}
          required
          type="password"
          value={password}
        />
        {message ? <Toast tone="error">{message}</Toast> : null}
        <div className="dls-dialog-actions">
          <Button disabled={busy} onClick={onCancel} tone="quiet">
            返回
          </Button>
          <Button
            busy={busy}
            disabled={!password || !exactConfirmationMatches(confirmationText, target)}
            type="submit"
          >
            确认提交：仍然健在
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
