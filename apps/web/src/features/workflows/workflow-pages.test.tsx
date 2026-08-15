import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { LegacyPage } from "../public/legacy-page";
import { computeRemainingSeconds, initialRemainingSeconds } from "../public/public-countdown";
import { PublicStatus } from "../public/public-status";
import { OwnerWorkflow } from "./owner-workflow";

describe("workflow and public legacy experiences", () => {
  test("renders every public projection without contact identities or private errors", () => {
    for (const state of [
      "NORMAL",
      "IN_PROGRESS",
      "PUBLISHING",
      "RELEASED",
      "UNAVAILABLE",
    ] as const) {
      const html = renderToStaticMarkup(
        <PublicStatus
          status={{
            state,
          }}
        />,
      );
      expect(html).toContain(
        state === "NORMAL"
          ? "系统正常运行"
          : state === "IN_PROGRESS"
            ? "系统正在处理流程"
            : state === "PUBLISHING"
              ? "正在生成公开内容"
              : state === "RELEASED"
                ? "数字遗产已发布"
                : "状态暂时不可用",
      );
      expect(html).not.toContain("example.com");
      expect(html).not.toContain("contactId");
    }
  });

  test("uses server clock offset for countdowns and disables cancellation after lock", () => {
    expect(
      computeRemainingSeconds(
        "2026-08-10T00:00:00.000Z",
        Date.parse("2026-08-09T23:00:00.000Z"),
        5000,
      ),
    ).toBe(3595);
    expect(initialRemainingSeconds("2026-08-10T06:00:00.000Z", "2026-08-09T06:00:00.000Z")).toBe(
      86_400,
    );
    const html = renderToStaticMarkup(
      <OwnerWorkflow
        workflow={{
          workflowId: "w1",
          state: "RELEASE_PENDING",
          releaseAt: "2026-08-10T00:00:00.000Z",
          publishLockedAt: "2026-08-09T23:59:59.000Z",
          approvedCount: 3,
          requiredCount: 3,
        }}
      />,
    );
    expect(html).toContain("发布已锁定或完成，无法撤回");
    expect(html).toContain("disabled");
  });

  test("renders only sanitized will HTML with verification and one stable download action", () => {
    const html = renderToStaticMarkup(
      <LegacyPage
        publication={{
          ownerDisplayName: "陈明",
          publishedAt: "2026-08-09T04:00:00.000Z",
          willHtml: "<h2>致我最亲爱的人</h2><p>正文</p>",
          packageBytes: 1024,
          packageSha256: "abcdef",
          auditRootHash: "123456",
        }}
      />,
    );
    expect(html).toContain("致我最亲爱的人");
    expect(html).toContain("dls-legacy-topbar");
    expect(html).toContain("/api/public/legacy/package");
    expect(html.match(/下载完整 ZIP/gu)?.length).toBe(1);
    expect(html).not.toContain("will.md 原始内容");
  });
});
