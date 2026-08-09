"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "../../components/ui/button";
import { Field } from "../../components/ui/field";
import { Toast } from "../../components/ui/toast";
import { apiRequest, setBrowserCsrfToken } from "../../lib/api/browser-client";
import { consumeFragmentToken, navigateAfterLogin, requestIdFrom } from "./form-security";

export function ContactLoginForm() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [entryToken, setEntryToken] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  useEffect(
    () =>
      setEntryToken(
        consumeFragmentToken("entry", {
          hash: location.hash,
          pathname: location.pathname,
          search: location.search,
          replaceState: history.replaceState.bind(history),
        }),
      ),
    [],
  );

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !displayName || !password) return;
    setBusy(true);
    try {
      const response = await apiRequest<{ data: { session: { csrfToken: string } } }>(
        "/auth/contact/login",
        {
          method: "POST",
          body: JSON.stringify({
            displayName: displayName.normalize("NFC"),
            password,
            ...(entryToken ? { entryToken } : {}),
          }),
        },
      );
      setPassword("");
      setEntryToken(undefined);
      setBrowserCsrfToken(response.data.session.csrfToken);
      navigateAfterLogin(router.push, "/contact/workflows/current");
    } catch (error) {
      const requestId = requestIdFrom(error);
      setMessage(`登录失败，请核对姓名和密码${requestId ? `。请求编号：${requestId}` : ""}`);
      setPassword("");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="dls-form-stack" onSubmit={submit}>
      <Field
        autoComplete="name"
        id="contact-name"
        label="姓名"
        name="displayName"
        onChange={(event) => setDisplayName(event.target.value)}
        required
        value={displayName}
      />
      <Field
        autoComplete="current-password"
        id="contact-password"
        label="联系人密码"
        name="password"
        onChange={(event) => setPassword(event.target.value)}
        required
        type="password"
        value={password}
      />
      {message ? <Toast tone="error">{message}</Toast> : null}
      <Button busy={busy} type="submit">
        联系人登录
      </Button>
      <p className="dls-form-note">邮件入口只定位流程，登录后仍需完成重新认证和明确确认。</p>
    </form>
  );
}
