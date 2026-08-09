"use client";

import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Field } from "../../components/ui/field";
import { Toast } from "../../components/ui/toast";
import { apiRequest, setBrowserCsrfToken } from "../../lib/api/browser-client";
import { requestIdFrom } from "./form-security";

export function OwnerLoginForm() {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || password.length === 0) return;
    setBusy(true);
    setMessage(undefined);
    try {
      const response = await apiRequest<{ data: { session: { csrfToken: string } } }>("/auth/owner/login", { method: "POST", body: JSON.stringify({ password }) });
      setPassword("");
      setBrowserCsrfToken(response.data.session.csrfToken);
      location.assign("/admin");
    } catch (error) {
      const requestId = requestIdFrom(error);
      setMessage(`登录失败，请检查主密码后重试${requestId ? `。请求编号：${requestId}` : ""}`);
      setPassword("");
    } finally { setBusy(false); }
  }

  async function requestRecovery() {
    if (busy) return;
    setBusy(true);
    try {
      await apiRequest("/auth/owner/password-recovery/request", { method: "POST", body: "{}" });
      setMessage("如已配置恢复邮箱，我们将发送后续说明。");
    } catch (error) {
      const requestId = requestIdFrom(error);
      setMessage(`如已配置恢复邮箱，我们将发送后续说明${requestId ? `。请求编号：${requestId}` : ""}。`);
    } finally { setBusy(false); }
  }

  return <form className="dls-form-stack" onSubmit={submit}><Field autoComplete="current-password" id="owner-password" label="主密码" name="password" onChange={(event) => setPassword(event.target.value)} required type="password" value={password} />{message ? <Toast tone={message.startsWith("登录失败") ? "error" : "info"}>{message}</Toast> : null}<Button busy={busy} type="submit">管理员登录</Button><Button disabled={busy} onClick={requestRecovery} tone="quiet">忘记主密码</Button><p className="dls-form-note">如已配置恢复邮箱，我们将发送后续说明。</p></form>;
}
