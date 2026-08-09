"use client";

import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Field } from "../../components/ui/field";
import { Toast } from "../../components/ui/toast";
import { createCryptoWorkerClient } from "../../crypto/worker-client";
import { apiRequest, setBrowserCsrfToken } from "../../lib/api/browser-client";
import { requestIdFrom, validateNewPassword } from "../auth/form-security";

export function SetupForm() {
  const [form, setForm] = useState({ setupToken: "", displayName: "", primaryEmail: "", backupEmail: "", password: "", confirmation: "" });
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState<string>();
  const update = (field: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) => setForm((current) => ({ ...current, [field]: event.target.value }));
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    const checked = validateNewPassword(form.password);
    if ("error" in checked) { setMessage(checked.error); return; }
    if (checked.normalized !== form.confirmation.normalize("NFC")) { setMessage("两次输入的主密码不一致"); return; }
    setBusy(true); setMessage("正在本地生成保险库密钥，请保持页面打开……");
    try {
      const cryptoResult = await createCryptoWorkerClient().run<{ envelope: Record<string, unknown> }>("createOwnerVault", { password: checked.normalized, vaultId: "pending-setup" });
      const response = await apiRequest<{ data: { session?: { csrfToken: string } } }>("/setup/owner", { method: "POST", body: JSON.stringify({ setupToken: form.setupToken, displayName: form.displayName.normalize("NFC"), primaryEmail: form.primaryEmail, ...(form.backupEmail ? { backupEmail: form.backupEmail } : {}), password: checked.normalized, ownerVaultEnvelope: cryptoResult.envelope }) });
      setForm({ setupToken: "", displayName: "", primaryEmail: "", backupEmail: "", password: "", confirmation: "" });
      setBrowserCsrfToken(response.data.session?.csrfToken); location.assign("/admin");
    } catch (error) { const requestId = requestIdFrom(error); setMessage(`初始化失败，请检查输入后重试${requestId ? `。请求编号：${requestId}` : ""}`); setForm((current) => ({ ...current, password: "", confirmation: "", setupToken: "" })); }
    finally { setBusy(false); }
  }
  return <form className="dls-form-stack" onSubmit={submit}><Field autoComplete="off" id="setup-token" label="部署初始化令牌" name="setupToken" onChange={update("setupToken")} required type="password" value={form.setupToken} /><Field autoComplete="name" id="owner-name" label="管理员姓名" name="displayName" onChange={update("displayName")} required value={form.displayName} /><Field autoComplete="email" id="primary-email" label="主邮箱" name="primaryEmail" onChange={update("primaryEmail")} required type="email" value={form.primaryEmail} /><Field autoComplete="email" hint="用于紧急通知，不得与主邮箱相同。" id="backup-email" label="备用邮箱（可选）" name="backupEmail" onChange={update("backupEmail")} type="email" value={form.backupEmail} /><Field autoComplete="new-password" hint="至少 12 个字符，最多 512 个 UTF-8 字节。" id="new-password" label="主密码" name="password" onChange={update("password")} required type="password" value={form.password} /><Field autoComplete="new-password" id="new-password-confirmation" label="再次输入主密码" name="confirmation" onChange={update("confirmation")} required type="password" value={form.confirmation} />{message ? <Toast tone={message.startsWith("正在") ? "info" : "error"}>{message}</Toast> : null}<Button busy={busy} type="submit">创建管理员与保险库</Button></form>;
}
