"use client";

import { useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { Field } from "../../components/ui/field";
import { Toast } from "../../components/ui/toast";
import { createCryptoWorkerClient } from "../../crypto/worker-client";
import { apiRequest } from "../../lib/api/browser-client";
import { requestIdFrom } from "../auth/form-security";
import type {
  ContactActionDialogProps,
  ContactCryptoMaterial,
  ContactFragmentResult,
} from "../workflows/contact-workflow-types";

export function ContactRecoveryApproval({
  open,
  workflow,
  onCancel,
  onComplete,
}: ContactActionDialogProps) {
  const [password, setPassword] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const submitting = useRef(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || !password || !acknowledged) return;
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
          purpose: "RECOVERY",
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
        `/contact/workflows/${encodeURIComponent(workflow.workflowId)}/approve-password-recovery`,
        {
          method: "POST",
          body: JSON.stringify({ password, ...fragment }),
        },
      );
      setAcknowledged(false);
      onComplete({ state: "PENDING", message: "恢复用途分片已安全提交，正在等待服务端验证。" });
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
            ? "密码恢复审批已经关闭或你已完成审批。"
            : `审批失败，请稍后重试${requestId ? `。请求编号：${requestId}` : ""}`,
      );
    } finally {
      setPassword("");
      setBusy(false);
      submitting.current = false;
    }
  }

  return (
    <Dialog
      description="该操作只会解开恢复用途分片，并重新封装到恢复专用入口。"
      {...(busy ? {} : { onClose: onCancel })}
      open={open}
      title="批准管理员密码恢复"
    >
      <form className="dls-form-stack" onSubmit={submit}>
        <div className="dls-recovery-purpose">
          <strong>用途隔离：RECOVERY</strong>
          <p>恢复分片不能用于死亡确认或遗产发布；服务端还会再次校验用途、代次和承诺摘要。</p>
        </div>
        <label className="dls-check">
          <input
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
            type="checkbox"
          />
          我确认管理员本人正在请求恢复主密码，并理解达到门槛后会向管理员主邮箱发送一次性重包装步骤。
        </label>
        <Field
          autoComplete="current-password"
          id="recovery-contact-password"
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
          <Button busy={busy} disabled={!password || !acknowledged} type="submit">
            确认批准密码恢复
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
