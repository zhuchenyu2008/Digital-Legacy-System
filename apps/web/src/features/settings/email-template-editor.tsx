"use client";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Toast } from "../../components/ui/toast";
import { apiRequest } from "../../lib/api/browser-client";

export function EmailTemplateEditor({ codes }: Readonly<{ codes: readonly string[] }>) {
  const [selected, setSelected] = useState(codes[0] ?? ""); const [preview, setPreview] = useState<string>(); const [message, setMessage] = useState<string>();
  async function loadPreview() { if (!selected) return; try { const response = await apiRequest<{ data: { html: string } }>(`/owner/email-templates/${encodeURIComponent(selected)}/preview`, { method: "POST", body: JSON.stringify({ mode: "synthetic" }) }); setPreview(response.data.html); setMessage(undefined); } catch { setMessage("无法加载模板预览。预览接口不会发送邮件。"); } }
  return <section className="dls-panel dls-form-stack"><h2>邮件模板预览</h2><label htmlFor="template-code">模板</label><select className="dls-input" id="template-code" onChange={(event) => setSelected(event.target.value)} value={selected}>{codes.map((code) => <option key={code} value={code}>{code}</option>)}</select><div className="dls-action-row"><Button onClick={loadPreview}>生成安全预览</Button><Button disabled tone="secondary">保存覆盖（尚未提供后端入口）</Button></div>{message ? <Toast tone="error">{message}</Toast> : null}{preview ? <iframe className="dls-email-preview" sandbox="" srcDoc={preview} title={`${selected} 邮件预览`} /> : null}</section>;
}
