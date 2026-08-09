"use client";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Toast } from "../../components/ui/toast";
export function DownloadPackage({ bytes, sha256 }: Readonly<{ bytes: number; sha256: string }>) { const [message, setMessage] = useState<string>(); async function copy() { await navigator.clipboard.writeText(sha256); setMessage("SHA-256 摘要已复制。"); } return <section className="dls-download-box"><h2>ZIP 下载地址</h2><p>文件大小：{(bytes / 1024 / 1024).toFixed(2)} MiB。移动网络下载可能产生流量费用。</p><label>SHA-256 摘要</label><code>{sha256}</code><div className="dls-action-row"><a className="dls-button dls-button--primary" download href="/api/public/legacy/package">下载完整 ZIP</a><Button onClick={copy} tone="secondary">复制摘要</Button></div>{message ? <Toast tone="success">{message}</Toast> : null}</section>; }
