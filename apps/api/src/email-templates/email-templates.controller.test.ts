import { describe, expect, test, vi } from "vitest";
import { EmailTemplatesController } from "./email-templates.controller";
import type { EmailTemplateRuntime } from "./email-templates.runtime";

describe("owner email template preview", () => {
  test("renders a no-store preview without sending mail", async () => {
    const preview = vi.fn().mockResolvedValue({
      subject: "预览主题",
      html: "<html><body>预览</body></html>",
      text: "预览",
      templateCode: "CONTACT_INVITATION",
      templateVersion: 1,
    });
    const controller = new EmailTemplatesController({ preview } as EmailTemplateRuntime);
    const reply = { header: vi.fn() };

    await expect(
      controller.preview(
        "CONTACT_INVITATION",
        { mode: "synthetic" },
        { id: "request-1" } as never,
        reply as never,
      ),
    ).resolves.toMatchObject({
      data: { templateCode: "CONTACT_INVITATION", html: expect.stringContaining("预览") },
      requestId: "request-1",
    });
    expect(preview).toHaveBeenCalledWith("CONTACT_INVITATION", { mode: "synthetic" });
    expect(reply.header).toHaveBeenCalledWith("cache-control", "no-store");
    expect(reply.header).toHaveBeenCalledWith("x-content-type-options", "nosniff");
  });
});
