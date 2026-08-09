"use client";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Field } from "../../components/ui/field";
import { Toast } from "../../components/ui/toast";
import { apiRequest } from "../../lib/api/browser-client";
import { requestIdFrom } from "../auth/form-security";

export type OwnerSettingsView = Readonly<{ missedDaysThreshold: number; timezone: string; settingsVersion: number; smtp: Readonly<{ configured: boolean }> }>;
export function SettingsForm({ initial, workflowLocked = false }: Readonly<{ initial: OwnerSettingsView; workflowLocked?: boolean }>) {
  const [threshold, setThreshold] = useState(initial.missedDaysThreshold); const [password, setPassword] = useState(""); const [busy, setBusy] = useState(false); const [message, setMessage] = useState<string>();
  async function submit(event: React.FormEvent<HTMLFormElement>) { event.preventDefault(); if (busy || workflowLocked) return; setBusy(true); try { await apiRequest("/owner/settings", { method: "PATCH", headers: { "if-match": String(initial.settingsVersion), "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ missedDaysThreshold: threshold, password }) }); setPassword(""); setMessage("配置已保存，新的签到截止时间将由服务端重新计算。"); } catch (error) { const requestId = requestIdFrom(error); setMessage(`保存失败${requestId ? `。请求编号：${requestId}` : ""}`); setPassword(""); } finally { setBusy(false); } }
  return <form className="dls-panel dls-form-stack" onSubmit={submit}><h2>核心配置</h2>{workflowLocked ? <Toast tone="error">进行中的工作流已锁定配置变更。</Toast> : null}<Field disabled={workflowLocked} id="missed-days" label="未签到触发阈值（天）" max={365} min={1} onChange={(event) => setThreshold(Number(event.target.value))} type="number" value={threshold} /><Field disabled id="timezone" label="系统时区" value={initial.timezone} /><Field autoComplete="current-password" disabled={workflowLocked} id="settings-password" label="主密码重新认证" onChange={(event) => setPassword(event.target.value)} type="password" value={password} /><Button busy={busy} disabled={workflowLocked} type="submit">保存配置</Button>{message ? <Toast tone={message.startsWith("配置已") ? "success" : "error"}>{message}</Toast> : null}</form>;
}
