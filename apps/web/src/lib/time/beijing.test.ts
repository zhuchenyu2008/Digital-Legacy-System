import { describe, expect, test } from "vitest";
import { formatBeijingDateTime, nextCountdownAnnouncement } from "./beijing.js";

describe("Beijing time presentation", () => {
  test("formats absolute instants in Asia/Shanghai instead of the host timezone", () => {
    expect(formatBeijingDateTime("2026-08-09T04:30:15.000Z")).toBe(
      "2026-08-09 12:30:15（北京时间）",
    );
  });

  test("announces countdowns only at meaningful boundaries", () => {
    expect(nextCountdownAnnouncement(86_401)).toBe("剩余 1 天 1 秒");
    expect(nextCountdownAnnouncement(3_661)).toBe("剩余 1 小时 1 分钟");
    expect(nextCountdownAnnouncement(601)).toBe("剩余 10 分钟");
    expect(nextCountdownAnnouncement(59)).toBe("剩余 59 秒");
    expect(nextCountdownAnnouncement(58)).toBeNull();
    expect(nextCountdownAnnouncement(0)).toBe("倒计时已结束，正在等待服务端确认发布状态");
  });
});
