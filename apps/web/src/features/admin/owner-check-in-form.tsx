"use client";

import { useState } from "react";
import { Icon } from "../../components/icons/icon";
import { Button } from "../../components/ui/button";
import { Field } from "../../components/ui/field";
import { Toast } from "../../components/ui/toast";
import { apiRequest } from "../../lib/api/browser-client";
import { requestIdFrom } from "../auth/form-security";

export function OwnerCheckInForm({
  variant = "desktop",
}: Readonly<{ variant?: "desktop" | "mobile" }>) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [message, setMessage] = useState<string>();

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || password.length === 0) return;
    setBusy(true);
    setMessage(undefined);
    try {
      await apiRequest("/owner/check-ins", {
        method: "POST",
        headers: { "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ password }),
      });
      setPassword("");
      setExpanded(false);
      setMessage("签到成功，截止时间已重新计算。");
      location.reload();
    } catch (error) {
      const requestId = requestIdFrom(error);
      setPassword("");
      setMessage(`签到失败，请检查主密码后重试${requestId ? `。请求编号：${requestId}` : ""}`);
    } finally {
      setBusy(false);
    }
  }

  if (variant === "mobile") {
    return (
      <form className="dls-checkin-form dls-checkin-form--mobile" onSubmit={submit}>
        <button
          aria-expanded={expanded}
          className="dls-mobile-checkin-trigger"
          onClick={() => setExpanded((value) => !value)}
          type="button"
        >
          <span className="dls-checkin-fingerprint">
            <Icon filled name="fingerprint" size={54} />
          </span>
          <strong>点击签到</strong>
        </button>
        {expanded ? (
          <div className="dls-mobile-checkin-fields">
            <Field
              autoComplete="current-password"
              id="dashboard-password-mobile"
              label="主密码"
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
            <Button busy={busy} type="submit">
              验证签到
            </Button>
          </div>
        ) : null}
        {message ? (
          <Toast tone={message.startsWith("签到成功") ? "success" : "error"}>{message}</Toast>
        ) : null}
      </form>
    );
  }

  return (
    <form
      className="dls-checkin-form dls-checkin-form--desktop"
      id="dashboard-checkin"
      onSubmit={submit}
    >
      <p>输入主密码以完成本次安全签到并重置计时器。</p>
      <div>
        <Field
          autoComplete="current-password"
          id="dashboard-password-desktop"
          label="主密码"
          onChange={(event) => setPassword(event.target.value)}
          required
          type="password"
          value={password}
        />
        <Button busy={busy} type="submit">
          验证签到
        </Button>
      </div>
      {message ? (
        <Toast tone={message.startsWith("签到成功") ? "success" : "error"}>{message}</Toast>
      ) : null}
    </form>
  );
}
