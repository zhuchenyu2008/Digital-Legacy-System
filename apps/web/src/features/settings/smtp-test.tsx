"use client";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Toast } from "../../components/ui/toast";
import { apiRequest } from "../../lib/api/browser-client";

export function SmtpTest({ configured }: Readonly<{ configured: boolean }>) {
  const [message, setMessage] = useState<string>(); const [busy, setBusy] = useState(false);
  async function send() { if (!configured || busy) return; setBusy(true); try { await apiRequest("/owner/settings/smtp-test", { method: "POST", headers: { "idempotency-key": crypto.randomUUID() }, body: "{}" }); setMessage("测试邮件已进入投递队列，请在邮件沙箱或收件箱中核对。"); } catch { setMessage("当前 API 未启用 SMTP 测试入口，请检查运维配置。"); } finally { setBusy(false); } }
  return <section className="dls-panel"><div className="dls-section-heading"><h2>SMTP 邮件服务</h2><span>{configured ? "已配置" : "未配置"}</span></div><p>测试不会改变业务状态，也不会发送任何遗产内容或敏感材料。</p><Button busy={busy} disabled={!configured} onClick={send} tone="secondary">发送测试邮件</Button>{!configured ? <p className="dls-form-note">配置完成后才能发送测试邮件。</p> : null}{message ? <Toast tone="info">{message}</Toast> : null}</section>;
}
