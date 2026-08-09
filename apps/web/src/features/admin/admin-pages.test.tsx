import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { ContactEditor } from "../contacts/contact-editor";
import { ContactList } from "../contacts/contact-list";
import { SettingsForm } from "../settings/settings-form";
import { SmtpTest } from "../settings/smtp-test";
import { EncryptedUpload } from "../vault/encrypted-upload";
import { PackageList } from "../vault/package-list";
import { uploadStateLabel } from "../vault/upload-state";
import { Dashboard } from "./dashboard";

describe("owner workspace surfaces", () => {
  test("renders only API-backed dashboard values and an honest arming checklist", () => {
    const html = renderToStaticMarkup(
      <Dashboard
        data={{
          status: "SETUP",
          lastCheckInAt: null,
          nextDeadlineAt: "2026-08-12T00:00:00.000Z",
          activeContacts: 2,
          requiredContacts: 3,
          activePackageVersion: null,
          auditEvents: [],
        }}
      />,
    );
    expect(html).toContain("还需要 1 位有效联系人");
    expect(html).toContain("2026-08-12 08:00:00（北京时间）");
    expect(html).not.toContain("V1");
  });

  test("shows contact lifecycle and package states without implying invite acceptance arms a contact", () => {
    const contacts = renderToStaticMarkup(
      <ContactList
        contacts={[
          {
            id: "c1",
            displayName: "张伟",
            email: "zhang@example.com",
            status: "ACTIVE",
            consentVersion: "1",
          },
          { id: "c2", displayName: "王强", email: "wang@example.com", status: "PENDING_KEYING" },
        ]}
      />,
    );
    expect(contacts).toContain("已激活");
    expect(contacts).toContain("待分片");
    expect(contacts).toContain("需要重新生成并激活分片代次");
    expect(contacts).toContain('aria-label="重新发送联系人邀请"');
    expect(contacts).toContain('aria-label="移除联系人"');

    const packages = renderToStaticMarkup(
      <PackageList
        packages={[
          {
            id: "p1",
            versionNo: 3,
            status: "READY",
            ciphertextSha256: "abc",
            uploadedAt: "2026-08-09T04:00:00.000Z",
          },
        ]}
      />,
    );
    expect(packages).toContain("V3");
    expect(packages).toContain("待激活");
  });

  test("uses the supplied Material Symbols for contact invitations and encrypted uploads", () => {
    expect(renderToStaticMarkup(<ContactEditor />)).toContain(">person_add</span>");
    expect(renderToStaticMarkup(<EncryptedUpload />)).toContain(">cloud_upload</span>");
  });

  test("locks settings during active workflows and names every upload stage", () => {
    const html = renderToStaticMarkup(
      <SettingsForm
        initial={{
          missedDaysThreshold: 3,
          timezone: "Asia/Shanghai",
          settingsVersion: 2,
          smtp: { configured: true },
        }}
        workflowLocked
      />,
    );
    expect(html).toContain("进行中的工作流已锁定配置变更");
    expect(html).toContain("disabled");
    expect(
      [
        "encrypting",
        "uploading",
        "verifying",
        "ready",
        "activating",
        "interrupted",
        "resumable",
        "aborted",
      ].map(uploadStateLabel),
    ).toEqual([
      "正在加密",
      "正在上传",
      "服务端校验中",
      "可激活",
      "正在激活",
      "上传中断",
      "可继续上传",
      "已中止",
    ]);
  });

  test("shows a factual SMTP summary without exposing credentials", () => {
    const html = renderToStaticMarkup(<SmtpTest configured />);
    expect(html).toContain("连接状态");
    expect(html).toContain("仅事务邮件");
    expect(html).toContain("不包含遗产正文或密钥材料");
    expect(html).not.toContain("API Key");
  });
});
