import Link from "next/link";
import { Icon } from "../../components/icons/icon";

export function DeathConfirming({
  approvedCount,
  requiredCount,
}: Readonly<{ approvedCount: number; requiredCount: number }>) {
  const safeRequired = Math.max(1, requiredCount);
  const safeApproved = Math.min(safeRequired, Math.max(0, approvedCount));
  const remaining = Math.max(0, safeRequired - safeApproved);
  const progress = safeApproved / safeRequired;
  const circumference = 2 * Math.PI * 54;
  const offset = circumference * (1 - progress);
  const currentPercent = `${(progress * 100).toFixed(1)}%`;

  return (
    <section className="dls-public-stage dls-enter dls-death-confirming">
      <div className="dls-death-ring">
        <svg aria-hidden="true" viewBox="0 0 120 120">
          <circle
            className="dls-death-ring-track"
            cx="60"
            cy="60"
            fill="transparent"
            r="54"
            strokeWidth="8"
          />
          <circle
            className="dls-death-ring-progress"
            cx="60"
            cy="60"
            fill="transparent"
            r="54"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            strokeWidth="8"
          />
        </svg>
        <div>
          <strong>
            {safeApproved} / {safeRequired}
          </strong>
          <span>确认进度</span>
        </div>
      </div>
      <h1>生存状态确认中</h1>
      <p>
        系统已进入“第一阶段确认”。目前已有 {safeApproved} 名紧急联系人响应，
        {remaining > 0
          ? `还需 ${remaining} 人确认以正式启动数字遗产交接程序。`
          : "确认门限已经达到，系统将进入最终等待期。"}
      </p>
      <div className="dls-public-actions">
        <Link className="dls-button dls-button--primary" href="/contact/login">
          紧急联系人登录
        </Link>
        <Link className="dls-button dls-button--secondary" href="/legal">
          查看操作手册
        </Link>
      </div>
      <div className="dls-public-info">
        <section className="dls-public-privacy">
          <Icon name="privacy" />
          <h2>身份完全隐藏</h2>
          <p>为保护所有参与者的隐私，系统不会在此页面显示任何联系人的具体身份、姓名或位置信息。</p>
        </section>
        <section className="dls-public-protocol">
          <div>
            <h2>70% 阈值门限逻辑</h2>
            <p>
              根据 PRD-DEATH1
              协议，遗产释放流程仅在超过预设比例的联系人独立确认后方可启动。此逻辑旨在防止误操作或单方面恶意申报。
            </p>
            <div className="dls-public-threshold-tags">
              <span>门限：70%</span>
              <span>当前：{currentPercent}</span>
            </div>
          </div>
          <span className="dls-public-protocol-visual" aria-hidden="true">
            <Icon name="gavel" size={42} />
          </span>
        </section>
        <section className="dls-public-admin-action">
          <div>
            <h2>如果您是管理员本人</h2>
            <p>
              若此流程系误触或测试启动，请立即登录并使用主密码终止“生存确认”流程。终止操作将被永久记录在不可篡改的审计日志中。
            </p>
          </div>
          <Link className="dls-button dls-button--danger" href="/login">
            立即终止流程
          </Link>
        </section>
      </div>
      <div className="dls-public-chain">
        <span>IMMUTABLE CHAIN OF CUSTODY</span>
        <ol>
          <li>聚合确认已被不可篡改地记录</li>
          <li>等待后续独立确认</li>
          <li>所有身份信息保持隐藏</li>
        </ol>
      </div>
    </section>
  );
}
