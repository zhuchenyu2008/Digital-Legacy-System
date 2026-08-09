"use client";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Toast } from "../../components/ui/toast";
import { apiRequest } from "../../lib/api/browser-client";
import { requestIdFrom } from "../auth/form-security";

export function ShareGenerationWizard({ needsRegeneration }: Readonly<{ needsRegeneration: boolean }>) {
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState<string>();
  async function begin() { if (busy) return; setBusy(true); try { await apiRequest("/owner/vault/share-generations", { method: "POST", headers: { "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({}) }); setMessage("已创建分片代次草稿。请重新认证并在浏览器内解开保险库密钥后继续。"); } catch (error) { const requestId = requestIdFrom(error); setMessage(`无法创建分片代次${requestId ? `。请求编号：${requestId}` : ""}`); } finally { setBusy(false); } }
  if (!needsRegeneration) return null;
  return <section className="dls-warning-panel"><h2>联系人集合已变更</h2><p>系统已返回配置状态。邀请接受本身不会启用联系人；必须重新认证、解开保险库密钥并激活新分片代次。</p><Button busy={busy} onClick={begin}>开始生成新分片代次</Button>{message ? <Toast tone="info">{message}</Toast> : null}</section>;
}
