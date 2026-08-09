"use client";
import { useEffect, useState } from "react";
import { nextCountdownAnnouncement } from "../../lib/time/beijing";

export function computeRemainingSeconds(
  deadline: string,
  clientNow: number,
  serverOffsetMs = 0,
): number {
  return Math.max(0, Math.floor((Date.parse(deadline) - (clientNow + serverOffsetMs)) / 1000));
}

export function initialRemainingSeconds(deadline: string, serverNow?: string): number {
  return computeRemainingSeconds(deadline, serverNow ? Date.parse(serverNow) : Date.now());
}

export function PublicCountdown({
  deadline,
  serverNow,
}: Readonly<{ deadline: string; serverNow?: string | undefined }>) {
  const [clock] = useState(() => {
    const clientStartedAt = Date.now();
    return {
      clientStartedAt,
      serverStartedAt: serverNow ? Date.parse(serverNow) : clientStartedAt,
    };
  });
  const [remaining, setRemaining] = useState(() => initialRemainingSeconds(deadline, serverNow));
  const [announcement, setAnnouncement] = useState(() => nextCountdownAnnouncement(remaining));
  useEffect(() => {
    const update = () => {
      const serverTime = clock.serverStartedAt + (Date.now() - clock.clientStartedAt);
      const value = computeRemainingSeconds(deadline, serverTime);
      setRemaining(value);
      const next = nextCountdownAnnouncement(value);
      if (next) setAnnouncement(next);
    };
    update();
    const timer = window.setInterval(update, 1000);
    const visible = () => {
      if (!document.hidden) update();
    };
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("focus", update);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("focus", update);
    };
  }, [clock, deadline]);
  const hours = Math.floor(remaining / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
  const seconds = remaining % 60;
  return (
    <div className="dls-public-countdown">
      <p>自动释放倒计时</p>
      <strong>
        {String(hours).padStart(2, "0")}:{String(minutes).padStart(2, "0")}:
        {String(seconds).padStart(2, "0")}
      </strong>
      <div className="dls-countdown-units" aria-hidden="true">
        <span>HOURS</span>
        <span>MINUTES</span>
        <span>SECONDS</span>
      </div>
      <div aria-live="polite" className="dls-sr-only">
        {announcement}
      </div>
      {remaining === 0 ? <p>倒计时已结束，正在等待服务端确认发布状态。</p> : null}
    </div>
  );
}
