"use client";

import { useState } from "react";
import { Button } from "../../components/ui/button";
import { EmptyState } from "../../components/ui/empty-state";
import { Progress } from "../../components/ui/progress";
import { StatusBadge } from "../../components/ui/status-badge";
import { ContactRecoveryApproval } from "../recovery/contact-recovery-approval";
import { aliveConfirmationText, deathConfirmationText } from "./confirmation-text";
import { ContactAliveConfirmation } from "./contact-alive-confirmation";
import { ContactDeathConfirmation } from "./contact-death-confirmation";
import type {
  ContactActionOutcome,
  ContactLegalAction,
  ContactWorkflowView,
} from "./contact-workflow-types";

type OpenAction = ContactLegalAction | undefined;

export function ContactWorkflow({ workflow }: Readonly<{ workflow: ContactWorkflowView | null }>) {
  const [openAction, setOpenAction] = useState<OpenAction>();
  const [outcome, setOutcome] = useState<ContactActionOutcome>();
  if (workflow === null) {
    return (
      <EmptyState description="当前没有需要你处理的死亡确认或密码恢复任务。" title="没有当前任务" />
    );
  }
  const alreadyClosed = workflow.decisionAlreadyMade || workflow.legalNextActions.length === 0;
  const resolved =
    outcome ??
    (workflow.decisionAlreadyMade
      ? { state: "PENDING" as const, message: "你的决定已提交，系统正在按服务端最终状态处理。" }
      : alreadyClosed
        ? { state: "CLOSED" as const, message: "此工作流当前不再接受你的决定。" }
        : undefined);
  const isRecovery = workflow.kind === "PASSWORD_RECOVERY";
  const complete = (value: ContactActionOutcome) => {
    setOutcome(value);
    setOpenAction(undefined);
  };
  return (
    <section className="dls-contact-workflow" aria-labelledby="contact-workflow-title">
      <div className={`dls-contact-alert dls-contact-alert--${isRecovery ? "recovery" : "death"}`}>
        <p className="dls-eyebrow">
          {isRecovery ? "PASSWORD RECOVERY / ACTION REQUIRED" : "SURVIVAL STATUS / ACTION REQUIRED"}
        </p>
        <h1 id="contact-workflow-title">
          {isRecovery
            ? `请审核 ${workflow.ownerDisplayName} 的主密码恢复`
            : `请确认 ${workflow.ownerDisplayName} 的联络状态`}
        </h1>
        <p>
          {isRecovery
            ? "只有在你确认管理员本人正在恢复密码时才应批准。"
            : "请只根据你实际掌握的情况作出决定。邮件链接本身不会改变任何流程状态。"}
        </p>
      </div>

      <div className="dls-contact-progress">
        <div>
          <StatusBadge tone={isRecovery ? "warning" : "critical"}>
            {isRecovery ? "恢复审批中" : "第一阶段确认中"}
          </StatusBadge>
          <span>
            {workflow.approvedCount} / {workflow.requiredCount} 份有效确认
          </span>
        </div>
        <Progress
          label="当前有效确认进度"
          max={workflow.requiredCount}
          value={workflow.approvedCount}
        />
      </div>

      {resolved ? (
        <section
          className={`dls-contact-result dls-contact-result--${resolved.state.toLowerCase()}`}
          aria-live="polite"
          role="status"
        >
          <h2>{resolved.state === "PENDING" ? "你的决定已提交" : "此操作已关闭"}</h2>
          <p>{resolved.message}</p>
          <p>请以服务端返回的最终状态为准，不要通过刷新或多标签页重复提交。</p>
        </section>
      ) : isRecovery ? (
        <section className="dls-contact-decision-list">
          <article>
            <div>
              <span aria-hidden="true">↻</span>
              <h2>批准本次密码恢复</h2>
            </div>
            <p>
              浏览器只会解开恢复用途分片，并重新封装到 RECOVERY
              专用入口；达到门槛后管理员仍需邮件验证码和新密码。
            </p>
            <Button onClick={() => setOpenAction("APPROVE_RECOVERY")}>审核并批准恢复</Button>
          </article>
        </section>
      ) : (
        <section className="dls-contact-decision-list" aria-label="可选决定">
          <article className="dls-contact-decision dls-contact-decision--critical">
            <div>
              <span aria-hidden="true">!</span>
              <h2>可能或确认已经离世</h2>
            </div>
            <p>提交死亡用途分片。只有达到门槛且经过服务端验证后，流程才会进入下一阶段。</p>
            <code>{deathConfirmationText(workflow.ownerDisplayName)}</code>
            <Button onClick={() => setOpenAction("CONFIRM_DEATH")} tone="danger">
              选择：可能或确认已经离世
            </Button>
          </article>
          <article className="dls-contact-decision dls-contact-decision--alive">
            <div>
              <span aria-hidden="true">✓</span>
              <h2>仍然健在</h2>
            </div>
            <p>
              立即终止本次死亡确认并重新安排签到；该决定会向管理员披露本次工作流快照中的联系人姓名。
            </p>
            <code>{aliveConfirmationText(workflow.ownerDisplayName)}</code>
            <Button onClick={() => setOpenAction("CONFIRM_ALIVE")} tone="secondary">
              选择：仍然健在
            </Button>
          </article>
        </section>
      )}

      <aside className="dls-contact-legal" aria-label="决定说明">
        <strong>提交前请确认</strong>
        <ul>
          <li>必须再次输入联系人密码。</li>
          <li>确认文字按 NFC 规范化后仍需逐字完全一致，不会自动去除空格。</li>
          <li>密码允许粘贴和密码管理器填充；只有确认文字禁止粘贴、拖放和自动填充。</li>
        </ul>
      </aside>

      <ContactDeathConfirmation
        onCancel={() => setOpenAction(undefined)}
        onComplete={complete}
        open={openAction === "CONFIRM_DEATH"}
        workflow={workflow}
      />
      <ContactAliveConfirmation
        onCancel={() => setOpenAction(undefined)}
        onComplete={complete}
        open={openAction === "CONFIRM_ALIVE"}
        workflow={workflow}
      />
      <ContactRecoveryApproval
        onCancel={() => setOpenAction(undefined)}
        onComplete={complete}
        open={openAction === "APPROVE_RECOVERY"}
        workflow={workflow}
      />
    </section>
  );
}

export type { ContactWorkflowView } from "./contact-workflow-types";
