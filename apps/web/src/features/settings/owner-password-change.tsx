"use client";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Field } from "../../components/ui/field";
import { Toast } from "../../components/ui/toast";
import { createCryptoWorkerClient } from "../../crypto/worker-client";
import { apiRequest } from "../../lib/api/browser-client";
import { requestIdFrom, validateNewPassword } from "../auth/form-security";

export function OwnerPasswordChange() {
  const [oldPassword, setOldPassword] = useState(""); const [newPassword, setNewPassword] = useState(""); const [confirmation, setConfirmation] = useState(""); const [busy, setBusy] = useState(false); const [message, setMessage] = useState<string>();
  async function submit(event: React.FormEvent<HTMLFormElement>) { event.preventDefault(); if (busy) return; const checked = validateNewPassword(newPassword); if ("error" in checked) { setMessage(checked.error); return; } if (checked.normalized !== confirmation.normalize("NFC")) { setMessage("两次输入的新主密码不一致"); return; } setBusy(true); try { const material = await apiRequest<{ data: { vaultId: string; ownerVaultEnvelope: Record<string, unknown> } }>("/owner/vault/material"); const wrapped = await createCryptoWorkerClient().run<{ envelope: Record<string, unknown> }>("rewrapOwnerVault", { oldPassword, newPassword: checked.normalized, envelope: material.data.ownerVaultEnvelope, vaultId: material.data.vaultId }); await apiRequest("/auth/owner/password-change", { method: "POST", body: JSON.stringify({ oldPassword, newPassword: checked.normalized, newOwnerVaultEnvelope: wrapped.envelope }) }); setOldPassword(""); setNewPassword(""); setConfirmation(""); setMessage("主密码已修改，其他管理员会话已撤销。"); } catch (error) { const requestId = requestIdFrom(error); setMessage(`修改失败${requestId ? `。请求编号：${requestId}` : ""}`); } finally { setBusy(false); } }
  return <form className="dls-panel dls-form-stack" onSubmit={submit}><h2>修改主密码</h2><p>保险库密钥只在浏览器内解开并使用新密码重新包装。</p><Field autoComplete="current-password" id="owner-old-password" label="当前主密码" onChange={(event) => setOldPassword(event.target.value)} type="password" value={oldPassword} /><Field autoComplete="new-password" id="owner-new-password" label="新主密码" onChange={(event) => setNewPassword(event.target.value)} type="password" value={newPassword} /><Field autoComplete="new-password" id="owner-new-confirmation" label="再次输入新主密码" onChange={(event) => setConfirmation(event.target.value)} type="password" value={confirmation} /><Button busy={busy} type="submit">重新包装保险库密钥并修改密码</Button>{message ? <Toast tone={message.startsWith("主密码已") ? "success" : "error"}>{message}</Toast> : null}</form>;
}
