"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Button } from "../../components/ui/button";
import { setBrowserCsrfToken } from "../../lib/api/browser-client";
import { CopyRequestId } from "./copy-request-id";

type ClearSensitiveOptions = Readonly<{
  passwordFields?: ArrayLike<{ value: string }>;
  clearCsrf?: () => void;
}>;

export function clearSensitiveClientState(options: ClearSensitiveOptions = {}): void {
  const passwordFields =
    options.passwordFields ??
    (typeof document === "undefined"
      ? []
      : document.querySelectorAll<HTMLInputElement>('input[type="password"]'));
  for (const field of Array.from(passwordFields)) field.value = "";
  (options.clearCsrf ?? (() => setBrowserCsrfToken(undefined)))();
}

export function SupportErrorState({
  code,
  requestId,
  retry,
}: Readonly<{ code: "403" | "404" | "error"; requestId?: string; retry?: () => void }>) {
  useEffect(() => clearSensitiveClientState(), []);
  const title = code === "error" ? "暂时无法完成请求" : "无法访问此页面或资源";
  return (
    <main className="dls-support-page">
      <section className="dls-support-error" role={code === "error" ? "alert" : undefined}>
        <p className="dls-eyebrow">{code === "error" ? "请求未完成" : code}</p>
        <h1>{title}</h1>
        <p>为保护隐私，系统不会说明页面或资源的具体状态。请检查登录身份，或返回安全入口后重试。</p>
        {requestId ? (
          <div className="dls-request-id">
            <span>请求编号</span>
            <code>{requestId}</code>
            <CopyRequestId requestId={requestId} />
          </div>
        ) : null}
        <div className="dls-support-actions">
          {retry ? (
            <Button
              onClick={() => {
                clearSensitiveClientState();
                retry();
              }}
            >
              安全重试
            </Button>
          ) : null}
          <Link className="dls-button dls-button--secondary" href="/">
            返回状态页
          </Link>
          <Link className="dls-button dls-button--quiet" href="/login">
            管理员登录
          </Link>
        </div>
      </section>
    </main>
  );
}
