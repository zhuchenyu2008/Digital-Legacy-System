"use client";

import { useState } from "react";
import { Icon } from "../../components/icons/icon";
import { Button } from "../../components/ui/button";
import { Toast } from "../../components/ui/toast";
import { apiRequest } from "../../lib/api/browser-client";

const milestones = [
  { target: "CHECKIN_DUE", label: "签到到期" },
  { target: "CONTACT_DECISION", label: "联系人决策" },
  { target: "RECOVERY_THRESHOLD", label: "恢复阈值" },
  { target: "RELEASE_COUNTDOWN", label: "释放倒计时" },
  { target: "SMTP_RETRY", label: "SMTP 失败重试" },
  { target: "PUBLICATION", label: "最终发布" },
] as const satisfies readonly Readonly<{ target: SimulationMilestone; label: string }>[];

type SimulationMilestone =
  | "CHECKIN_DUE"
  | "CONTACT_DECISION"
  | "RECOVERY_THRESHOLD"
  | "RELEASE_COUNTDOWN"
  | "SMTP_RETRY"
  | "PUBLICATION";

type SimulationScenario = Readonly<{
  id: string;
  currentAt: string;
  state: "READY" | SimulationMilestone;
}>;

type ApiEnvelope<T> = Readonly<{ data: T; requestId: string }>;

export function SimulationConsole({ defaultOwnerEmail }: Readonly<{ defaultOwnerEmail: string }>) {
  const [scenario, setScenario] = useState<SimulationScenario>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  async function create() {
    if (busy) return;
    setBusy(true);
    try {
      const simulationId = crypto.randomUUID();
      const response = await apiRequest<ApiEnvelope<SimulationScenario>>("/owner/simulations", {
        method: "POST",
        body: JSON.stringify({
          simulationId,
          ownerEmail: defaultOwnerEmail,
          contactEmails: [
            "contact-1@example.test",
            "contact-2@example.test",
            "contact-3@example.test",
          ],
          startAt: new Date().toISOString(),
        }),
      });
      setScenario(response.data);
      setMessage("测试模式场景已创建，正式业务数据未发生变化。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "测试模式场景创建失败");
    } finally {
      setBusy(false);
    }
  }

  async function advance(target: SimulationMilestone) {
    if (busy || scenario === undefined) return;
    setBusy(true);
    try {
      const response = await apiRequest<
        ApiEnvelope<Readonly<{ currentAt: string; state: SimulationMilestone }>>
      >(`/owner/simulations/${scenario.id}/advance`, {
        method: "POST",
        headers: { "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ target }),
      });
      setScenario({
        ...scenario,
        currentAt: response.data.currentAt,
        state: response.data.state,
      });
      setMessage(`测试模式时间已推进到 ${response.data.state}。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "测试模式推进失败");
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    if (busy || scenario === undefined) return;
    setBusy(true);
    try {
      await apiRequest(`/owner/simulations/${scenario.id}/reset`, { method: "POST", body: "{}" });
      setScenario(undefined);
      setMessage("测试模式场景已重置。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "测试模式重置失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dls-simulation-console">
      <div className="dls-page-heading">
        <span className="dls-simulation-mode">测试模式</span>
        <h1>工作流仿真</h1>
        <p>隔离推进合成场景的时间与故障节点。</p>
      </div>

      <section className="dls-panel dls-simulation-state">
        <div>
          <span>测试模式状态</span>
          <strong>{scenario?.state ?? "未创建"}</strong>
        </div>
        <div>
          <span>虚拟时间</span>
          <strong>{scenario?.currentAt ?? "-"}</strong>
        </div>
        <Button busy={busy} disabled={scenario !== undefined} onClick={create}>
          <Icon name="add" />
          创建仿真场景
        </Button>
      </section>

      <section aria-label="测试模式时间推进" className="dls-simulation-actions">
        {milestones.map((entry) => (
          <Button
            disabled={scenario === undefined || busy}
            key={entry.target}
            onClick={() => advance(entry.target)}
            tone="secondary"
          >
            <Icon name="schedule" />
            {entry.label}
          </Button>
        ))}
      </section>

      <section className="dls-panel dls-simulation-reset">
        <div>
          <span className="dls-simulation-mode">测试模式</span>
          <h2>重置隔离场景</h2>
          <p>仅删除仿真数据库和仿真对象前缀中的合成数据。</p>
        </div>
        <Button disabled={scenario === undefined || busy} onClick={reset} tone="danger">
          <Icon name="delete" />
          重置仿真
        </Button>
      </section>
      {message ? <Toast tone="info">{message}</Toast> : null}
    </div>
  );
}
