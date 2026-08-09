import { Progress } from "../../components/ui/progress";
export function RecoveryStatus({
  approvedCount,
  requiredCount,
}: Readonly<{ approvedCount: number; requiredCount: number }>) {
  return (
    <section className="dls-public-stage">
      <p className="dls-eyebrow">OWNER PASSWORD RECOVERY</p>
      <h1>密码恢复处理中</h1>
      <p>系统正在等待达到恢复门限。该流程不会暂停签到截止时间，也不会公开联系人身份。</p>
      <Progress label="密码恢复审批进度" max={requiredCount} value={approvedCount} />
    </section>
  );
}
