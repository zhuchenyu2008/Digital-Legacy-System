"use client";
import { useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { Progress } from "../../components/ui/progress";
import { Toast } from "../../components/ui/toast";
import { uploadStateLabel, type UploadState } from "./upload-state";

export function EncryptedUpload({ maxBytes = 50 * 1024 * 1024 }: Readonly<{ maxBytes?: number }>) {
  const workerRef = useRef<Worker | undefined>(undefined); const [state, setState] = useState<UploadState>("idle"); const [progress, setProgress] = useState(0); const [message, setMessage] = useState<string>();
  function select(event: React.ChangeEvent<HTMLInputElement>) { const file = event.target.files?.[0]; if (!file) return; if (file.size > maxBytes) { setMessage(`文件超过部署允许的 ${Math.floor(maxBytes / 1024 / 1024)} MiB`); return; } const worker = new Worker(new URL("./upload.worker.ts", import.meta.url), { type: "module" }); workerRef.current = worker; setState("encrypting"); setProgress(1); worker.onmessage = (message: MessageEvent<{ type: string; message?: string; plaintextBytes?: number }>) => { if (message.data.type === "progress") setProgress((value) => Math.min(90, value + 4)); if (message.data.type === "prepared") { setProgress(100); setState("ready"); setMessage("浏览器加密完成。密文元数据已就绪，激活时仍需主密码重新认证。"); worker.terminate(); } if (message.data.type === "error") { setState("interrupted"); setMessage(message.data.message ?? "加密失败"); worker.terminate(); } }; worker.onerror = () => { setState("interrupted"); setMessage("密码学工作线程意外终止"); worker.terminate(); }; worker.postMessage({ file, vaultId: "pending", packageId: crypto.randomUUID(), packageVersion: 1 }); }
  function abort() { workerRef.current?.terminate(); workerRef.current = undefined; setState("aborted"); setProgress(0); }
  return <section className="dls-upload"><div className="dls-upload-drop"><span aria-hidden="true">⇧</span><h2>上传更新包（ZIP）</h2><p>文件会在本地分块加密，仅密文离开浏览器。服务端将再次验证 ZIP 和唯一的 will.md。</p><label className="dls-button dls-button--primary" htmlFor="vault-package">选择文件</label><input accept=".zip,application/zip" hidden id="vault-package" onChange={select} type="file" /></div>{state !== "idle" ? <div className="dls-upload-progress"><div className="dls-section-heading"><strong>{uploadStateLabel(state)}</strong><span>{progress}%</span></div><Progress label="加密上传进度" max={100} value={progress} />{state === "encrypting" || state === "uploading" ? <Button onClick={abort} tone="secondary">中止</Button> : null}</div> : null}{message ? <Toast tone={state === "ready" ? "success" : "error"}>{message}</Toast> : null}</section>;
}
