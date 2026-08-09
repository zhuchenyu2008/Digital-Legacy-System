"use client";

import { useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { Field } from "../../components/ui/field";
import { Toast } from "../../components/ui/toast";
import { createCryptoWorkerClient } from "../../crypto/worker-client";
import { apiRequest } from "../../lib/api/browser-client";
import { requestIdFrom } from "../auth/form-security";
import {
  ConfirmationText,
  deathConfirmationText,
  exactConfirmationMatches,
} from "./confirmation-text";
import type {
  ContactActionDialogProps,
  ContactCryptoMaterial,
  ContactFragmentResult,
} from "./contact-workflow-types";

export function ContactDeathConfirmation({
  open,
  workflow,
  onCancel,
  onComplete,
}: ContactActionDialogProps) {
  const target = deathConfirmationText(workflow.ownerDisplayName);
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
      const response = await apiRequest<{ data: ContactCryptoMaterial }>(
        "/contact/crypto-material",
      );
      const material = response.data;
      const fragment = await createCryptoWorkerClient().run<ContactFragmentResult>(
        "createContactFragment",
        {
          password,
          workflowId: workflow.workflowId,
          purpose: "DEATH",
          vaultId: material.vaultId,
          contactId: material.contactId,
          threshold: workflow.requiredCount,
          publicKey: material.publicKey,
          privateKeyEnvelope: material.privateKeyEnvelope,
          share: workflow.share,
          ingress: workflow.ingress,
        },
      );
      await apiRequest(
        `/contact/workflows/${encodeURIComponent(workflow.workflowId)}/confirm-death`,
        {
          method: "POST",
          body: JSON.stringify({ password, confirmationText, fragment }),
        },
      );
      setConfirmationText("");
      onComplete({
        state: "PENDING",
        message: "分片已安全提交，正在等待服务端验证。请勿重复提交。",
      });
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
      description="该决定会提交你的死亡用途分片，服务端验证完成前不会推进工作流。"
      {...(busy ? {} : { onClose: onCancel })}
      open={open}
      title="确认：可能或确认已经离世"
    >
      <form className="dls-form-stack" onSubmit={submit}>
        <ConfirmationText
          id="death-confirmation-text"
          onChange={setConfirmationText}
          target={target}
          value={confirmationText}
        />
        <Field
          autoComplete="current-password"
          id="death-contact-password"
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
            tone="danger"
            type="submit"
          >
            确认提交：可能或确认已经离世
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
