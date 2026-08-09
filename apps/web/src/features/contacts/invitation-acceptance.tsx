"use client";

import { useEffect, useState } from "react";
import { Button } from "../../components/ui/button";
import { Field } from "../../components/ui/field";
import { Toast } from "../../components/ui/toast";
import { createCryptoWorkerClient } from "../../crypto/worker-client";
import { apiRequest } from "../../lib/api/browser-client";
import { consumeFragmentToken, requestIdFrom, validateNewPassword } from "../auth/form-security";

const consentItems = [
  "我理解联系人无法查看其他联系人身份",
  "我理解确认决定会进入不可篡改审计",
  "我理解第二阶段开始后联系人不能终止发布",
  "我理解注册后仍需管理员生成并激活新分片代次",
] as const;

export function InvitationAcceptance() {
  const [token, setToken] = useState<string>();
  const [invitation, setInvitation] = useState<{
    ownerName?: string;
    vaultId?: string;
    contactId?: string;
    consentVersion?: string;
    consentDocumentSha256?: string;
  }>();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [accepted, setAccepted] = useState<boolean[]>(consentItems.map(() => false));
  const [remaining, setRemaining] = useState(30);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  useEffect(() => {
    const value = consumeFragmentToken("invite", {
      hash: location.hash,
      pathname: location.pathname,
      search: location.search,
      replaceState: history.replaceState.bind(history),
    });
    setToken(value);
    if (!value) {
      setMessage("邀请入口缺失或已被浏览器清除");
      return;
    }
    void apiRequest<{ data: typeof invitation }>("/contact-invitations/resolve", {
      method: "POST",
      body: JSON.stringify({ token: value }),
    })
      .then((response) => setInvitation(response.data))
      .catch((error) =>
        setMessage(
          `邀请无法使用${requestIdFrom(error) ? `。请求编号：${requestIdFrom(error)}` : ""}`,
        ),
      );
  }, []);
  useEffect(() => {
    if (!invitation || remaining <= 0) return;
    const timer = window.setInterval(() => setRemaining((value) => Math.max(0, value - 1)), 1000);
    return () => clearInterval(timer);
  }, [invitation, remaining]);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !token || !invitation?.vaultId || !invitation.contactId) return;
    const checked = validateNewPassword(password);
    if ("error" in checked) {
      setMessage(checked.error);
      return;
    }
    if (checked.normalized !== confirmation.normalize("NFC")) {
      setMessage("两次输入的联系人密码不一致");
      return;
    }
    if (remaining > 0 || accepted.some((value) => !value)) {
      setMessage("请完整阅读知情书并逐项确认");
      return;
    }
    setBusy(true);
    try {
      const cryptoResult = await createCryptoWorkerClient().run<{
        privateKeyEnvelope: Record<string, unknown>;
      }>("createContactKeys", {
        password: checked.normalized,
        vaultId: invitation.vaultId,
        contactId: invitation.contactId,
      });
      await apiRequest("/contact-invitations/accept", {
        method: "POST",
        body: JSON.stringify({
          token,
          password: checked.normalized,
          privateKeyEnvelope: cryptoResult.privateKeyEnvelope,
          consent: {
            version: invitation.consentVersion,
            documentSha256: invitation.consentDocumentSha256,
            termsAccepted: true,
            privacyAccepted: true,
            denialDisclosureAccepted: true,
            stage2LockAccepted: true,
          },
        }),
      });
      setPassword("");
      setConfirmation("");
      setToken(undefined);
      setMessage("注册已完成。当前状态为待分片，管理员激活新分片代次后才能参加确认。");
    } catch (error) {
      const requestId = requestIdFrom(error);
      setMessage(`注册失败${requestId ? `。请求编号：${requestId}` : ""}`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="dls-form-stack" onSubmit={submit}>
      <section className="dls-consent">
        <p className="dls-eyebrow">知情同意书 {invitation?.consentVersion ?? ""}</p>
        <h2>成为紧急联系人意味着什么</h2>
        <p>
          {invitation?.ownerName ? `${invitation.ownerName} 邀请您` : "管理员邀请您"}
          在其逾期未签到时，根据您实际掌握的情况作出独立判断。您不会获得遗产内容，也看不到其他联系人身份。
        </p>
        <p>
          只有达到预设门限，系统才会进入最终等待阶段。进入第二阶段后，紧急联系人不能撤销或干预发布；只有管理员能在发布锁定前使用主密码终止。
        </p>
        <p>
          您的私钥只在此浏览器内生成，并使用联系人密码包装后保存。联系人密码、私钥和分片明文不会写入
          URL、日志或持久化浏览器存储。
        </p>
      </section>
      {consentItems.map((item, index) => (
        <label className="dls-check" key={item}>
          <input
            checked={accepted[index]}
            disabled={remaining > 0}
            onChange={(event) =>
              setAccepted((values) =>
                values.map((value, itemIndex) =>
                  itemIndex === index ? event.target.checked : value,
                ),
              )
            }
            type="checkbox"
          />
          {item}
        </label>
      ))}
      {remaining > 0 ? <p aria-live="polite">请继续阅读 {remaining} 秒后可逐项确认。</p> : null}
      <Field
        autoComplete="new-password"
        id="contact-new-password"
        label="设置联系人密码"
        onChange={(event) => setPassword(event.target.value)}
        type="password"
        value={password}
      />
      <Field
        autoComplete="new-password"
        id="contact-new-password-confirm"
        label="再次输入联系人密码"
        onChange={(event) => setConfirmation(event.target.value)}
        type="password"
        value={confirmation}
      />
      {message ? (
        <Toast tone={message.startsWith("注册已完成") ? "success" : "error"}>{message}</Toast>
      ) : null}
      <Button
        busy={busy}
        disabled={remaining > 0 || accepted.some((value) => !value) || !invitation}
        type="submit"
      >
        接受邀请并生成联系人密钥
      </Button>
    </form>
  );
}
