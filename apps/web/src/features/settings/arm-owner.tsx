"use client";

import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Field } from "../../components/ui/field";
import { Toast } from "../../components/ui/toast";
import { apiRequest } from "../../lib/api/browser-client";

const CONFIRMATION = "我理解并接受数字遗产发布后不可撤回";

export function ArmOwner() {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await apiRequest("/owner/arm", {
        method: "POST",
        headers: { "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ password, confirmationText: confirmation }),
      });
      setPassword("");
      setConfirmation("");
      setMessage("系统已进入 ARMED 状态。不可撤回风险确认已记录。");
    } catch {
      setMessage("尚未满足启用条件，请先完成联系人、分片、加密文件包和 SMTP 测试。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="dls-panel dls-form-stack" onSubmit={submit}>
      <h2>启用 ARMED</h2>
      <p>完成所有配置后，输入完整确认文字并重新认证。发布后的数字遗产不可撤回。</p>
      <Field
        autoComplete="current-password"
        id="arm-owner-password"
        label="当前主密码"
        onChange={(event) => setPassword(event.target.value)}
        type="password"
        value={password}
      />
      <Field
        id="arm-owner-confirmation"
        label={`输入：${CONFIRMATION}`}
        onChange={(event) => setConfirmation(event.target.value)}
        value={confirmation}
      />
      <Button busy={busy} type="submit">
        确认并启用 ARMED
      </Button>
      {message ? (
        <Toast tone={message.startsWith("系统已") ? "success" : "error"}>{message}</Toast>
      ) : null}
    </form>
  );
}
