import { describe, expect, it } from "vitest";
import { renderTemplate, validateTemplateOverride } from "./render-template.js";
import { TEMPLATE_CODES, type TemplateCode } from "./template-codes.js";
import { TEMPLATE_CONTRACTS } from "./template-contracts.js";

const contexts: Readonly<Record<TemplateCode, Readonly<Record<string, string>>>> = {
  CONTACT_INVITATION: {
    owner_name: "张三",
    contact_name: "李四",
    expires_at: "2026-08-09T02:30:00Z",
    action_url: "https://example.test/contact/invite#token=one-time",
  },
  CHECKIN_REMINDER: {
    remaining: "24 小时",
    deadline_at: "2026-08-09T02:30:00Z",
    action_url: "https://example.test/login",
  },
  DEATH_CONFIRMATION_REQUEST: {
    owner_name: "张三",
    action_url: "https://example.test/contact/workflow#entry=one-time",
  },
  DEATH_CANCELLED_BY_CONTACT: {
    owner_name: "张三",
    denier_name: "李四",
    denier_email: "li@example.test",
    cancelled_at: "2026-08-09T02:30:00Z",
  },
  DEATH_CANCELLED_BY_OWNER: {
    owner_name: "张三",
    cancelled_at: "2026-08-09T02:30:00Z",
  },
  DEATH_STAGE2_REMINDER: {
    remaining: "1 小时",
    release_at: "2026-08-09T02:30:00Z",
    action_url: "https://example.test/owner/workflow",
  },
  LEGACY_RELEASED: {
    owner_name: "张三",
    published_at: "2026-08-09T02:30:00Z",
    legacy_url: "https://example.test/public/legacy",
    download_url: "https://example.test/public/legacy/download",
    sha256: "ab".repeat(32),
  },
  CONTACT_PASSWORD_CHANGE: {
    owner_name: "张三",
    expires_at: "2026-08-09T02:30:00Z",
    action_url: "https://example.test/contact/password#token=one-time",
  },
  OWNER_RECOVERY_START: {
    expires_at: "2026-08-09T02:30:00Z",
    action_url: "https://example.test/recovery/start#token=one-time",
  },
  OWNER_RECOVERY_CONTACT_REQUEST: {
    owner_name: "张三",
    expires_at: "2026-08-09T02:30:00Z",
    action_url: "https://example.test/contact/recovery#entry=one-time",
  },
  OWNER_PASSWORD_RESET: {
    expires_at: "2026-08-09T02:30:00Z",
    action_url: "https://example.test/recovery/reset#token=one-time&code=12345678",
  },
};

describe("semantic email templates", () => {
  it("defines all eleven PRD templates with exact required placeholders", () => {
    expect(TEMPLATE_CODES).toEqual(Object.keys(contexts));
    for (const code of TEMPLATE_CODES) {
      expect(TEMPLATE_CONTRACTS[code].required).toEqual(Object.keys(contexts[code]));
    }
  });

  it.each(TEMPLATE_CODES)("renders safe HTML and equivalent text for %s", async (code) => {
    const rendered = await renderTemplate(code, contexts[code]);
    expect(rendered).toMatchObject({ templateCode: code, templateVersion: 1 });
    expect(rendered.subject.length).toBeGreaterThan(0);
    expect(rendered.html).not.toMatch(
      /<script|<form|<img|javascript:|data:|https?:\/\/[^\s"']+\.(?:gif|png|jpe?g)/iu,
    );
    expect(rendered.html).not.toContain("{{");
    expect(rendered.text).not.toContain("{{");
    expect(rendered.text.length).toBeGreaterThan(40);
    for (const field of ["action_url", "legacy_url", "download_url"] as const) {
      const value = contexts[code][field];
      if (value === undefined) continue;
      expect(rendered.text).toContain(value);
      const decodedHtml = rendered.html.replaceAll("&amp;", "&").replaceAll("&#x3D;", "=");
      expect(decodedHtml.split(value).length).toBeGreaterThanOrEqual(3);
    }
  });

  it("escapes all values, formats instants in Beijing, and rejects context drift", async () => {
    const rendered = await renderTemplate("CONTACT_INVITATION", {
      ...contexts.CONTACT_INVITATION,
      owner_name: '<script>alert("x")</script>',
    });
    expect(rendered.subject).not.toContain("<script>");
    expect(rendered.html).not.toContain("<script>");
    expect(rendered.html).toContain("&lt;script&gt;");
    expect(rendered.text).toContain('<script>alert("x")</script>');
    expect(rendered.html).toContain("2026-08-09 10:30:00（北京时间）");
    await expect(
      renderTemplate("CONTACT_INVITATION", { ...contexts.CONTACT_INVITATION, unknown: "x" }),
    ).rejects.toThrow("unknown");
    const { action_url: _missing, ...missing } = contexts.CONTACT_INVITATION;
    await expect(renderTemplate("CONTACT_INVITATION", missing)).rejects.toThrow("action_url");
    await expect(
      renderTemplate("CONTACT_INVITATION", {
        ...contexts.CONTACT_INVITATION,
        owner_name: "张三\r\nBcc: attacker@example.test",
      }),
    ).rejects.toThrow("line breaks");
    await expect(
      renderTemplate("CONTACT_INVITATION", {
        ...contexts.CONTACT_INVITATION,
        action_url: "ftp://example.test/invitation",
      }),
    ).rejects.toThrow("HTTP(S)");
  });

  it("validates preview overrides against the same placeholder and active-content contract", async () => {
    const override = {
      version: 7,
      subjectTemplate: "【邀请】{{owner_name}} 邀请你",
      bodyTemplate:
        '<h1>邀请</h1><p>{{contact_name}}，{{owner_name}} 邀请你。</p><p>{{expires_at}}</p><p><a class="button" href="{{action_url}}">继续</a></p><p class="plain-url">{{action_url}}</p>',
      textTemplate:
        "邀请\n{{contact_name}}，{{owner_name}} 邀请你。\n{{expires_at}}\n{{action_url}}",
    } as const;
    expect(validateTemplateOverride("CONTACT_INVITATION", override)).toEqual(override);
    await expect(
      renderTemplate("CONTACT_INVITATION", contexts.CONTACT_INVITATION, override),
    ).resolves.toMatchObject({ templateVersion: 7 });

    await expect(
      Promise.resolve().then(() =>
        validateTemplateOverride("CONTACT_INVITATION", {
          ...override,
          bodyTemplate: "<p>{{{owner_name}}}</p>",
        }),
      ),
    ).rejects.toThrow("triple-stash");
    await expect(
      Promise.resolve().then(() =>
        validateTemplateOverride("CONTACT_INVITATION", {
          ...override,
          textTemplate: "{{owner_name}} {{unknown_field}}",
        }),
      ),
    ).rejects.toThrow("unknown template fields");
    await expect(
      Promise.resolve().then(() =>
        validateTemplateOverride("CONTACT_INVITATION", {
          ...override,
          textTemplate: "{{owner_name}}",
        }),
      ),
    ).rejects.toThrow("missing template fields");
  });
});
