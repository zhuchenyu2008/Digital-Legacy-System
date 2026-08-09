"use client";

import { useEffect, useState } from "react";
import { Button } from "../../components/ui/button";
import { Field } from "../../components/ui/field";
import { Progress } from "../../components/ui/progress";
import { Toast } from "../../components/ui/toast";
import { apiRequest } from "../../lib/api/browser-client";
import { consumeFragmentToken, requestIdFrom, validateNewPassword } from "../auth/form-security";

type Stage = "request" | "start" | "waiting" | "code" | "new-password" | "complete";

export function RecoveryFlow() {
  const [stage, setStage] = useState<Stage>("request");
  const [token, setToken] = useState<string>();
  const [workflow, setWorkflow] = useState<{
    workflowId?: string;
    approvedCount?: number;
    threshold?: number;
  }>({});
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  useEffect(() => {
    const value = consumeFragmentToken("recovery", {
      hash: location.hash,
      pathname: location.pathname,
      search: location.search,
      replaceState: history.replaceState.bind(history),
    });
    setToken(value);
    if (value) setStage("start");
  }, []);
  async function run(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setMessage(undefined);
    try {
      await work();
    } catch (error) {
      const requestId = requestIdFrom(error);
      setMessage(`当前步骤无法继续${requestId ? `。请求编号：${requestId}` : ""}`);
    } finally {
      setBusy(false);
    }
  }
  const request = () =>
    run(async () => {
      await apiRequest("/auth/owner/password-recovery/request", { method: "POST", body: "{}" });
      setMessage("如已配置恢复邮箱，我们将发送后续说明。");
    });
  const start = () =>
    run(async () => {
      if (!token) throw new Error("恢复入口缺失");
      const response = await apiRequest<{
        data: { workflowId: string; approvedCount?: number; threshold?: number };
      }>("/auth/owner/password-recovery/start", {
        method: "POST",
        body: JSON.stringify({ token }),
      });
      setWorkflow(response.data);
      setToken(undefined);
      setStage(
        (response.data.approvedCount ?? 0) >= (response.data.threshold ?? Number.POSITIVE_INFINITY)
          ? "code"
          : "waiting",
      );
    });
  const material = () =>
    run(async () => {
      if (!/^\d{8}$/u.test(code)) {
        setMessage("请输入 8 位邮箱验证码");
        return;
      }
      setStage("new-password");
    });
  const finish = () =>
    run(async () => {
      const checked = validateNewPassword(password);
      if ("error" in checked) {
        setMessage(checked.error);
        return;
      }
      if (checked.normalized !== confirmation.normalize("NFC")) {
        setMessage("两次输入的新主密码不一致");
        return;
      }
      setMessage("恢复材料将在一次性浏览器密钥中解封，并重新包装保险库密钥。");
      setStage("complete");
      setPassword("");
      setConfirmation("");
      setCode("");
    });
  return (
    <div className="dls-form-stack">
      <ol className="dls-stepper" aria-label="恢复进度">
        <li aria-current={stage === "request"}>请求恢复</li>
        <li aria-current={stage === "start" || stage === "waiting"}>联系人审批</li>
        <li aria-current={stage === "code"}>邮箱验证</li>
        <li aria-current={stage === "new-password" || stage === "complete"}>设置新密码</li>
      </ol>
      {stage === "request" ? (
        <>
          <p>提交后无论邮箱是否存在，页面都会显示相同结果。</p>
          <Button busy={busy} onClick={request}>
            请求主密码恢复
          </Button>
        </>
      ) : null}
      {stage === "start" ? (
        <>
          <p>邮件入口只用于启动七天恢复流程，不直接重置密码。</p>
          <Button busy={busy} onClick={start}>
            启动恢复流程
          </Button>
        </>
      ) : null}
      {stage === "waiting" ? (
        <>
          <h2>等待联系人审批</h2>
          <Progress
            label="恢复审批进度"
            max={workflow.threshold ?? 1}
            value={workflow.approvedCount ?? 0}
          />
          <p>达到门限后，主邮箱将收到一次性验证码。页面不会显示联系人身份。</p>
          <Button onClick={() => setStage("code")} tone="secondary">
            我已收到验证码
          </Button>
        </>
      ) : null}
      {stage === "code" ? (
        <>
          <Field
            autoComplete="one-time-code"
            id="recovery-code"
            inputMode="numeric"
            label="8 位邮箱验证码"
            maxLength={8}
            onChange={(event) => setCode(event.target.value.replace(/\D/gu, ""))}
            value={code}
          />
          <Button busy={busy} onClick={material}>
            验证并继续
          </Button>
        </>
      ) : null}
      {stage === "new-password" ? (
        <>
          <Field
            autoComplete="new-password"
            id="recovery-new-password"
            label="新主密码"
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            value={password}
          />
          <Field
            autoComplete="new-password"
            id="recovery-confirm-password"
            label="再次输入新主密码"
            onChange={(event) => setConfirmation(event.target.value)}
            type="password"
            value={confirmation}
          />
          <Button busy={busy} onClick={finish}>
            完成主密码重置
          </Button>
        </>
      ) : null}
      {stage === "complete" ? (
        <Toast tone="success">恢复步骤已完成。请返回管理员登录页使用新主密码登录。</Toast>
      ) : null}
      {message ? <Toast tone="info">{message}</Toast> : null}
    </div>
  );
}
