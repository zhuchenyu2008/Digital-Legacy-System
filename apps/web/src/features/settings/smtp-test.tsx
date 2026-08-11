"use client";

import { useState } from "react";
import { Icon } from "../../components/icons/icon";
import { Button } from "../../components/ui/button";
import { Toast } from "../../components/ui/toast";
import { apiRequest } from "../../lib/api/browser-client";

const smtpFacts = [
  { icon: "dns", label: "服务器地址", value: "由部署环境管理 : 受保护" },
  { icon: "server", label: "端口", value: "受保护" },
  { icon: "mail", label: "发件人邮箱", value: "由部署环境管理" },
  { icon: "lock", label: "加密方式", value: "由服务端强制" },
  { icon: "user", label: "用户名", value: "凭据已安全加载" },
  { icon: "key", label: "密码 / 密钥", value: "••••••••" },
] as const;

export function SmtpTest({ configured }: Readonly<{ configured: boolean }>) {
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function send() {
    if (!configured || busy) return;
    setBusy(true);
    try {
      const result = await apiRequest<{ data?: { status?: string } }>("/owner/smtp-settings/test", {
        method: "POST",
        headers: { "idempotency-key": crypto.randomUUID() },
        body: "{}",
      });
      setMessage(
        result.data?.status === "SUCCESS"
          ? "SMTP 测试成功，已向主邮箱发送安全测试邮件。"
          : "SMTP 测试已完成但未成功，请检查服务端配置。",
      );
    } catch {
      setMessage("当前 API 未启用 SMTP 测试入口，请检查运维配置。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="dls-panel dls-smtp-panel">
      <div className="dls-section-heading">
        <h2>
          <span className="dls-settings-mobile-copy">SMTP 服务</span>
          <span className="dls-settings-desktop-copy">
            <Icon name="mail" />
            SMTP 邮件服务配置
          </span>
        </h2>
        <span className={configured ? "is-connected" : ""}>
          <Icon name={configured ? "check_circle" : "alert"} size={15} />
          {configured ? "已连接" : "未配置"}
        </span>
      </div>
      <div className="dls-smtp-facts">
        {smtpFacts.map((fact) => (
          <p key={fact.label}>
            <Icon name={fact.icon} />
            <span>{fact.label}</span>
            <strong>{configured ? fact.value : "未配置"}</strong>
            <Icon name="chevron_right" size={20} />
          </p>
        ))}
      </div>
      <p className="dls-smtp-note">测试不会改变业务状态，也不会发送任何遗产内容或敏感材料。</p>
      <div className="dls-smtp-action">
        <Button busy={busy} disabled={!configured} onClick={send} tone="secondary">
          <Icon name="send" size={18} />
          发送测试邮件
        </Button>
      </div>
      <span className="dls-sr-only">
        连接状态：{configured ? "已连接" : "未配置"}
        。发送范围：仅事务邮件。不包含遗产正文或密钥材料。
      </span>
      {!configured ? <p className="dls-form-note">配置完成后才能发送测试邮件。</p> : null}
      {message ? <Toast tone="info">{message}</Toast> : null}
    </section>
  );
}
