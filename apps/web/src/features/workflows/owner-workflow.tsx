import Link from "next/link";
import { Icon } from "../../components/icons/icon";
import { formatBeijingDateTime } from "../../lib/time/beijing";
import { PublicCountdown } from "../public/public-countdown";
import { CancelReleaseDialog } from "./cancel-release-dialog";

export type OwnerWorkflowView = Readonly<{
  workflowId: string;
  state: string;
  releaseAt: string | null;
  serverNow?: string | undefined;
  publishLockedAt?: string | null | undefined;
  approvedCount: number;
  requiredCount: number;
}>;

export function OwnerWorkflow({ workflow }: Readonly<{ workflow: OwnerWorkflowView }>) {
  const locked =
    Boolean(workflow.publishLockedAt) ||
    workflow.state === "PUBLISHING" ||
    workflow.state === "RELEASED";
  const threshold = Math.round(
    (workflow.approvedCount / Math.max(1, workflow.requiredCount)) * 100,
  );
  return (
    <div className="dls-owner-workflow">
      <div className="dls-critical-banner">
        SYSTEM STATUS: RELEASE PENDING — FINAL 24-HOUR WINDOW
      </div>
      <section className="dls-workflow-intro">
        <div className="dls-alert-mark">
          <Icon name="alert" size={40} />
        </div>
        <h1>最终释放确认阶段</h1>
        <p>
          已检测到受信任联系人的 {threshold}%
          确认阈值。除非您在以下倒计时结束前手动干预，否则数字遗产将在倒计时结束后自动释放。
        </p>
        {workflow.releaseAt ? (
          <PublicCountdown deadline={workflow.releaseAt} serverNow={workflow.serverNow} />
        ) : null}
      </section>
      <div className="dls-workflow-grid">
        <CancelReleaseDialog disabled={locked} workflowId={workflow.workflowId} />
        <aside className="dls-workflow-aside">
          <section className="dls-panel dls-workflow-audit">
            <h2>
              <Icon name="history" size={18} />
              最新审计日志
            </h2>
            <ol>
              <li>
                <strong>PHASE_02_TRIGGERED</strong>
                <small>
                  {workflow.serverNow
                    ? formatBeijingDateTime(workflow.serverNow)
                    : "服务端时间待同步"}
                </small>
                <p>
                  已达到 {workflow.approvedCount} / {workflow.requiredCount}{" "}
                  冻结门限，系统自动切换至释放待定状态。
                </p>
              </li>
              <li>
                <strong>PHASE_01_COMPLETE</strong>
                <small>聚合确认已由服务端验证</small>
              </li>
            </ol>
            <Link href="/admin/audit">查看完整不可篡改日志</Link>
          </section>
          <section className="dls-panel dls-workflow-explanation">
            <h2>紧急终止说明</h2>
            <ul>
              <li>
                <Icon name="info" size={18} />
                只有管理员主密码可终止流程
              </li>
              <li>
                <Icon name="security" size={18} />
                终止后系统将立即返回 ARMED 状态
              </li>
              <li>
                <Icon name="notification" size={18} />
                系统会同步通知所有紧急联系人
              </li>
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
