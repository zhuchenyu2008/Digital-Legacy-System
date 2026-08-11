"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Field } from "../../components/ui/field";
import { Toast } from "../../components/ui/toast";
import { createCryptoWorkerClient } from "../../crypto/worker-client";
import { apiRequest } from "../../lib/api/browser-client";
import { requestIdFrom } from "../auth/form-security";
import { runShareGenerationFlow } from "./share-generation-flow";

export function ShareGenerationWizard({
  needsRegeneration,
}: Readonly<{ needsRegeneration: boolean }>) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  async function begin() {
    if (busy) return;
    setBusy(true);
    try {
      const result = await runShareGenerationFlow(password.normalize("NFC"), {
        request: apiRequest,
        buildUpload: (input) =>
          createCryptoWorkerClient().run<Readonly<Record<string, unknown>>>(
            "createShareGeneration",
            input,
          ),
      });
      setPassword("");
      setMessage(
        result.systemState === "ARMED"
          ? "新分片代次已生成并激活，系统已进入 ARMED 状态。"
          : "新分片代次已生成并激活。完成加密文件包与风险确认后系统将进入 ARMED 状态。",
      );
      router.refresh();
    } catch (error) {
      const requestId = requestIdFrom(error);
      setMessage(`无法生成并激活分片代次${requestId ? `。请求编号：${requestId}` : ""}`);
    } finally {
      setPassword("");
      setBusy(false);
    }
  }
  if (!needsRegeneration) return null;
  return (
    <section className="dls-warning-panel">
      <h2>联系人集合已变更</h2>
      <p>
        系统已返回配置状态。邀请接受本身不会启用联系人；必须重新认证、解开保险库密钥并激活新分片代次。
      </p>
      <Field
        autoComplete="current-password"
        id="share-generation-owner-password"
        label="当前主密码"
        onChange={(event) => setPassword(event.target.value)}
        type="password"
        value={password}
      />
      <Button busy={busy} onClick={begin}>
        生成并激活新分片代次
      </Button>
      {message ? (
        <Toast tone={message.startsWith("新分片") ? "success" : "error"}>{message}</Toast>
      ) : null}
    </section>
  );
}
