import Link from "next/link";
import { StatusBadge } from "../../components/ui/status-badge";
import { DeathConfirming } from "./death-confirming";
export type PublicStatusData = Readonly<{
  state: "NORMAL" | "IN_PROGRESS" | "DEATH_CONFIRMING" | "PUBLISHING" | "RELEASED" | "UNAVAILABLE";
  approvedCount?: number | undefined;
  requiredCount?: number | undefined;
  serverNow?: string | undefined;
}>;
export function PublicStatus({ status }: Readonly<{ status: PublicStatusData }>) {
  if (status.state === "DEATH_CONFIRMING")
    return (
      <DeathConfirming
        approvedCount={status.approvedCount ?? 0}
        requiredCount={status.requiredCount ?? 1}
      />
    );
  if (status.state === "IN_PROGRESS")
    return (
      <section className="dls-public-stage">
        <StatusBadge tone="critical">处理中</StatusBadge>
        <h1>系统正在处理流程</h1>
        <p>系统正在执行受保护的内部流程。公开页面不会展示审批进度、恢复类型或内部时间点。</p>
      </section>
    );
  if (status.state === "PUBLISHING")
    return (
      <section className="dls-public-stage">
        <h1>正在生成公开内容</h1>
        <p>发布已锁定，系统正在验证、解密并原子提交公开对象。请稍后刷新。</p>
      </section>
    );
  if (status.state === "RELEASED")
    return (
      <section className="dls-public-stage">
        <StatusBadge tone="safe">已发布</StatusBadge>
        <h1>数字遗产已发布</h1>
        <p>公开遗书、验证摘要和不可变审计已经可用。</p>
        <Link className="dls-button dls-button--primary" href="/legacy">
          查看公开遗书
        </Link>
      </section>
    );
  if (status.state === "UNAVAILABLE")
    return (
      <section className="dls-public-stage">
        <h1>状态暂时不可用</h1>
        <p>系统没有公开内部错误。请稍后重试，管理员可登录健康页查看。</p>
      </section>
    );
  return (
    <section className="dls-public-stage">
      <StatusBadge tone="safe">正常</StatusBadge>
      <h1>系统正常运行</h1>
      <p>数字遗产仍处于私有保管状态。只有满足既定门限和等待期后才会公开。</p>
      <div className="dls-public-actions">
        <Link className="dls-button dls-button--primary" href="/login">
          管理员登录
        </Link>
        <Link className="dls-button dls-button--secondary" href="/contact/login">
          联系人登录
        </Link>
      </div>
    </section>
  );
}
