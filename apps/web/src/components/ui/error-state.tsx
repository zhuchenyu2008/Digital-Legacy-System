import type { ReactNode } from "react";

export function ErrorState({
  action,
  requestId,
  title = "暂时无法完成操作",
}: Readonly<{ action?: ReactNode; requestId?: string; title?: string }>) {
  return (
    <section className="dls-state dls-state--error" role="alert">
      <h2>{title}</h2>
      <p>请稍后重试。若问题持续，请向管理员提供请求编号。</p>
      {requestId ? <code>{requestId}</code> : null}
      {action}
    </section>
  );
}
