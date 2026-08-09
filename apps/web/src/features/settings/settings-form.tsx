"use client";

import { useState } from "react";
import { Icon } from "../../components/icons/icon";
import { Button } from "../../components/ui/button";
import { Field } from "../../components/ui/field";
import { Toast } from "../../components/ui/toast";
import { apiRequest } from "../../lib/api/browser-client";
import { requestIdFrom } from "../auth/form-security";

export type OwnerSettingsView = Readonly<{
  missedDaysThreshold: number;
  timezone: string;
  settingsVersion: number;
  smtp: Readonly<{ configured: boolean }>;
}>;

export function SettingsForm({
  initial,
  workflowLocked = false,
}: Readonly<{ initial: OwnerSettingsView; workflowLocked?: boolean }>) {
  const [threshold, setThreshold] = useState(initial.missedDaysThreshold);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [message, setMessage] = useState<string>();

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || workflowLocked) return;
    if (!password) {
      setNeedsAuth(true);
      setMessage("保存配置前请输入主密码完成重新认证。");
      return;
    }
    setBusy(true);
    try {
      await apiRequest("/owner/settings", {
        method: "PATCH",
        headers: {
          "if-match": String(initial.settingsVersion),
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify({ missedDaysThreshold: threshold, password }),
      });
      setPassword("");
      setNeedsAuth(false);
      setMessage("配置已保存，新的签到截止时间将由服务端重新计算。");
    } catch (error) {
      const requestId = requestIdFrom(error);
      setMessage(`保存失败${requestId ? `。请求编号：${requestId}` : ""}`);
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setThreshold(initial.missedDaysThreshold);
    setPassword("");
    setNeedsAuth(false);
    setMessage(undefined);
  }

  return (
    <form
      className="dls-settings-config"
      id="owner-settings-form"
      onReset={reset}
      onSubmit={submit}
    >
      <section className="dls-panel dls-settings-mobile-summary">
        <h2>核心配置</h2>
        <div className="dls-settings-mobile-rows">
          <details>
            <summary className="dls-settings-row">
              <Icon name="timer" />
              <span>
                <strong>未签到触发阈值（天）</strong>
                <small>{threshold} 天</small>
              </span>
              <Icon name="chevron_right" size={20} />
            </summary>
            <div className="dls-settings-mobile-editor">
              <Field
                disabled={workflowLocked}
                id="missed-days-mobile"
                label="未签到触发阈值（天）"
                max={365}
                min={1}
                onChange={(event) => setThreshold(Number(event.target.value))}
                type="number"
                value={threshold}
              />
              <Field
                autoComplete="current-password"
                disabled={workflowLocked}
                id="settings-password-mobile"
                label="主密码重新认证"
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                value={password}
              />
              <Button busy={busy} disabled={workflowLocked} type="submit">
                保存配置
              </Button>
            </div>
          </details>
          <div className="dls-settings-row">
            <Icon name="public" />
            <span>
              <strong>系统时区</strong>
              <small>{initial.timezone}（北京时间）</small>
            </span>
          </div>
        </div>
      </section>

      <section className="dls-panel dls-settings-desktop-form">
        <h2>
          <Icon name="settings" />
          核心配置
        </h2>
        {workflowLocked ? <Toast tone="error">进行中的工作流已锁定配置变更。</Toast> : null}
        <div className="dls-settings-core-fields">
          <Field
            disabled={workflowLocked}
            hint="连续未签到超过此天数，系统将进入 PENDING 状态。"
            id="missed-days-desktop"
            label="未签到触发阈值（天）"
            max={365}
            min={1}
            onChange={(event) => setThreshold(Number(event.target.value))}
            type="number"
            value={threshold}
          />
          <Field
            disabled
            hint="用于计算签到周期与时间戳记录。"
            id="timezone-desktop"
            label="系统时区"
            value={`${initial.timezone}（北京时间）`}
          />
        </div>
      </section>

      <section className="dls-panel dls-settings-security">
        <h2>
          <span className="dls-settings-mobile-copy">安全与审计</span>
          <span className="dls-settings-desktop-copy">
            <Icon name="security" />
            系统安全
          </span>
        </h2>
        <div className="dls-settings-risk">
          <Icon name="alert" />
          <div>
            <strong>不可撤回风险确认</strong>
            <small>确认 RELEASE 状态不可逆转</small>
          </div>
          <span aria-label="已确认" className="dls-settings-toggle" role="img">
            <i />
          </span>
        </div>
        <div className="dls-settings-reset">
          <Icon name="delete" />
          <div>
            <strong>重置系统</strong>
            <small>清除所有数据并恢复初始状态</small>
          </div>
          <span aria-hidden="true">
            <Icon name="chevron_right" size={20} />
          </span>
        </div>
        <div
          className={`dls-settings-reauth${needsAuth || threshold !== initial.missedDaysThreshold ? " is-visible" : ""}`}
        >
          <Field
            autoComplete="current-password"
            disabled={workflowLocked}
            id="settings-password-desktop"
            label="主密码重新认证"
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            value={password}
          />
        </div>
        {message ? (
          <Toast tone={message.startsWith("配置已") ? "success" : "error"}>{message}</Toast>
        ) : null}
        <div className="dls-settings-form-actions">
          <Button disabled={busy} tone="secondary" type="reset">
            取消更改
          </Button>
          <Button busy={busy} disabled={workflowLocked} type="submit">
            保存配置
          </Button>
        </div>
      </section>
    </form>
  );
}
