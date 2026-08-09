"use client";

import { useEffect, useState } from "react";
import { Button } from "../../components/ui/button";
import { Field } from "../../components/ui/field";
import { Toast } from "../../components/ui/toast";
import { createCryptoWorkerClient } from "../../crypto/worker-client";
import { apiRequest } from "../../lib/api/browser-client";
import { consumeFragmentToken, requestIdFrom, validateNewPassword } from "../auth/form-security";

export function ContactPasswordChange() {
  const [token, setToken] = useState<string>();
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  useEffect(
    () =>
      setToken(
        consumeFragmentToken("password-change", {
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
    if (busy) return;
    const checked = validateNewPassword(newPassword);
    if ("error" in checked) {
      setMessage(checked.error);
      return;
    }
    if (checked.normalized !== confirmation.normalize("NFC")) {
      setMessage("两次输入的新密码不一致");
      return;
    }
    setBusy(true);
    try {
      const material = await apiRequest<{
        data: {
          publicKey: string;
          privateKeyEnvelope: Record<string, unknown>;
          keyId: string;
          vaultId: string;
          contactId: string;
        };
      }>("/contact/crypto-material");
      const result = await createCryptoWorkerClient().run<{
        publicKey: string;
        ciphertext: string;
        nonce: string;
        kdfSalt: string;
        kdfParams: Record<string, unknown>;
        privateKeyProof: string;
      }>("rewrapContactPrivateKey", {
        oldPassword,
        newPassword: checked.normalized,
        publicKey: material.data.publicKey,
        envelope: material.data.privateKeyEnvelope,
        keyId: material.data.keyId,
        vaultId: material.data.vaultId,
        contactId: material.data.contactId,
      });
      await apiRequest("/contacts/password-change/complete", {
        method: "POST",
        body: JSON.stringify({
          ...(token ? { token } : {}),
          oldPassword,
          newPassword: checked.normalized,
          newPrivateKeyEnvelope: result,
        }),
      });
      setOldPassword("");
      setNewPassword("");
      setConfirmation("");
      setToken(undefined);
      setMessage("联系人密码已更新，历史分片仍然有效。");
    } catch (error) {
      const requestId = requestIdFrom(error);
      setMessage(`密码修改失败${requestId ? `。请求编号：${requestId}` : ""}`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="dls-form-stack" onSubmit={submit}>
      <Field
        autoComplete="current-password"
        id="contact-old-password"
        label="当前联系人密码"
        onChange={(event) => setOldPassword(event.target.value)}
        type="password"
        value={oldPassword}
      />
      <Field
        autoComplete="new-password"
        id="contact-change-password"
        label="新联系人密码"
        onChange={(event) => setNewPassword(event.target.value)}
        type="password"
        value={newPassword}
      />
      <Field
        autoComplete="new-password"
        id="contact-change-confirm"
        label="再次输入新联系人密码"
        onChange={(event) => setConfirmation(event.target.value)}
        type="password"
        value={confirmation}
      />
      {message ? (
        <Toast tone={message.startsWith("联系人密码已更新") ? "success" : "error"}>{message}</Toast>
      ) : null}
      <Button busy={busy} type="submit">
        重新包装联系人私钥并修改密码
      </Button>
    </form>
  );
}
