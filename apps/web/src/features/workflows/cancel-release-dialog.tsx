"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../../components/icons/icon";
import { Field } from "../../components/ui/field";
import { Toast } from "../../components/ui/toast";
import { apiRequest } from "../../lib/api/browser-client";
import { requestIdFrom } from "../auth/form-security";

const HOLD_DURATION_MS = 3000;

export function CancelReleaseDialog({
  disabled,
  workflowId,
}: Readonly<{ disabled: boolean; workflowId: string }>) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState<string>();
  const frame = useRef<number | undefined>(undefined);
  const startedAt = useRef(0);

  const stopHold = useCallback((reset = true) => {
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    frame.current = undefined;
    if (reset) setProgress(0);
  }, []);

  async function cancel() {
    if (disabled || busy || !password) return;
    setBusy(true);
    try {
      await apiRequest(`/owner/workflows/${workflowId}/cancel`, {
        method: "POST",
        headers: { "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ password, confirmation: "OWNER_CONFIRMED_ALIVE" }),
      });
      setPassword("");
      setMessage("流程已终止，系统将返回已启用状态并通知所有快照联系人。");
      location.reload();
    } catch (error) {
      const status =
        typeof error === "object" && error && "status" in error
          ? Number((error as { status: number }).status)
          : 0;
      setMessage(
        status === 409
          ? "发布已锁定或完成，无法撤回"
          : `终止失败${requestIdFrom(error) ? `。请求编号：${requestIdFrom(error)}` : ""}`,
      );
      setPassword("");
    } finally {
      setBusy(false);
      setProgress(0);
    }
  }

  function startHold() {
    if (disabled || busy || password.length === 0 || frame.current !== undefined) return;
    startedAt.current = performance.now();
    const tick = (now: number) => {
      const next = Math.min(100, ((now - startedAt.current) / HOLD_DURATION_MS) * 100);
      setProgress(next);
      if (next >= 100) {
        stopHold(false);
        void cancel();
        return;
      }
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }

  useEffect(() => () => stopHold(false), [stopHold]);

  return (
    <section className="dls-cancel-box">
      <div className="dls-cancel-heading">
        <Icon name="security" />
        <h2>立即终止流程</h2>
      </div>
      <p id="cancel-hold-copy">
        如果您处于安全状态且这是误报，请输入主密码并持续按住确认键 3
        秒。服务端会再次验证密码、工作流状态和幂等键。
      </p>
      <Field
        autoComplete="current-password"
        disabled={disabled}
        id="cancel-password"
        label="MASTER ACCESS PASSWORD"
        onChange={(event) => setPassword(event.target.value)}
        type="password"
        value={password}
      />
      <div className="dls-cancel-hold">
        <button
          aria-describedby="cancel-hold-copy"
          className="dls-cancel-hold-button"
          data-hold-required={HOLD_DURATION_MS}
          disabled={disabled || busy || password.length === 0}
          onKeyDown={(event) => {
            if ((event.key === " " || event.key === "Enter") && !event.repeat) {
              event.preventDefault();
              startHold();
            }
          }}
          onKeyUp={(event) => {
            if (event.key === " " || event.key === "Enter") stopHold();
          }}
          onPointerCancel={() => stopHold()}
          onPointerDown={startHold}
          onPointerLeave={() => stopHold()}
          onPointerUp={() => stopHold()}
          type="button"
        >
          <strong>{busy ? "正在终止释放" : "长按 3 秒以终止释放"}</strong>
          <span>HOLD TO TERMINATE PROCESS</span>
        </button>
        <span className="dls-cancel-hold-track">
          <i style={{ width: `${progress}%` }} />
        </span>
      </div>
      {disabled ? <Toast tone="error">发布已锁定或完成，无法撤回</Toast> : null}
      {message ? (
        <Toast tone={message.startsWith("流程已") ? "success" : "error"}>{message}</Toast>
      ) : null}
    </section>
  );
}
