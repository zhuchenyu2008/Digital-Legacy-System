const formatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

export function formatBeijingDateTime(value: string | number | Date): string {
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(value)).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}（北京时间）`;
}

export function countdownParts(totalSeconds: number) {
  const safe = Math.max(0, Math.floor(totalSeconds));
  return {
    days: Math.floor(safe / 86_400),
    hours: Math.floor((safe % 86_400) / 3_600),
    minutes: Math.floor((safe % 3_600) / 60),
    seconds: safe % 60,
  };
}

export function nextCountdownAnnouncement(totalSeconds: number): string | null {
  const safe = Math.max(0, Math.floor(totalSeconds));
  if (safe === 0) return "倒计时已结束，正在等待服务端确认发布状态";
  const { days, hours, minutes, seconds } = countdownParts(safe);
  if (days > 0 && (safe === 86_401 || safe % 21_600 === 0)) {
    return `剩余 ${days} 天${hours > 0 ? ` ${hours} 小时` : seconds > 0 ? ` ${seconds} 秒` : ""}`;
  }
  if (safe > 3_600 && (safe === 3_661 || safe % 3_600 === 0)) {
    return `剩余 ${hours} 小时${minutes > 0 ? ` ${minutes} 分钟` : ""}`;
  }
  if (safe > 60 && (safe === 601 || safe % 300 === 0)) return `剩余 ${minutes} 分钟`;
  if (safe <= 60 && (safe === 60 || safe === 59 || safe <= 10)) return `剩余 ${safe} 秒`;
  return null;
}
