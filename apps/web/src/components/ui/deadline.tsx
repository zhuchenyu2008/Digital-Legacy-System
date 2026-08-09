import { countdownParts, formatBeijingDateTime } from "../../lib/time/beijing.js";

export function Deadline({ deadline, now = Date.now() }: Readonly<{ deadline: string; now?: number }>) {
  const remaining = Math.max(0, Math.floor((new Date(deadline).getTime() - now) / 1000));
  const parts = countdownParts(remaining);
  return (
    <section className="dls-deadline">
      <p>截止时间：{formatBeijingDateTime(deadline)}</p>
      <strong>{parts.days > 0 ? `${parts.days} 天 ` : ""}{String(parts.hours).padStart(2, "0")}:{String(parts.minutes).padStart(2, "0")}:{String(parts.seconds).padStart(2, "0")}</strong>
    </section>
  );
}
