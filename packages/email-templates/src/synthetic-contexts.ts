import type { TemplateCode } from "./template-codes.js";

export const SYNTHETIC_TEMPLATE_CONTEXTS: Readonly<
  Record<TemplateCode, Readonly<Record<string, string>>>
> = Object.freeze({
  CONTACT_INVITATION: {
    owner_name: "示例所有者",
    contact_name: "示例联系人",
    expires_at: "2026-08-10T06:00:00.000Z",
    action_url: "https://example.invalid/contact-invitations#token=synthetic-preview",
  },
  CHECKIN_REMINDER: {
    remaining: "24 小时",
    deadline_at: "2026-08-10T06:00:00.000Z",
    action_url: "https://example.invalid/login",
  },
  DEATH_CONFIRMATION_REQUEST: {
    owner_name: "示例所有者",
    action_url: "https://example.invalid/contact/workflows/current#entry=synthetic-preview",
  },
  DEATH_CANCELLED_BY_CONTACT: {
    owner_name: "示例所有者",
    denier_name: "示例联系人",
    denier_email: "contact@example.invalid",
    cancelled_at: "2026-08-09T06:00:00.000Z",
  },
  DEATH_CANCELLED_BY_OWNER: {
    owner_name: "示例所有者",
    cancelled_at: "2026-08-09T06:00:00.000Z",
  },
  DEATH_STAGE2_REMINDER: {
    remaining: "24 小时",
    release_at: "2026-08-10T06:00:00.000Z",
    action_url: "https://example.invalid/admin/workflows/current",
  },
  LEGACY_RELEASED: {
    owner_name: "示例所有者",
    published_at: "2026-08-09T06:00:00.000Z",
    legacy_url: "https://example.invalid/legacy",
    download_url: "https://example.invalid/api/public/legacy/package",
    sha256: "ab".repeat(32),
  },
  CONTACT_PASSWORD_CHANGE: {
    owner_name: "示例所有者",
    expires_at: "2026-08-10T06:00:00.000Z",
    action_url: "https://example.invalid/contact/password-change#token=synthetic-preview",
  },
  OWNER_RECOVERY_START: {
    expires_at: "2026-08-10T06:00:00.000Z",
    action_url: "https://example.invalid/password-recovery#token=synthetic-preview",
  },
  OWNER_RECOVERY_CONTACT_REQUEST: {
    owner_name: "示例所有者",
    expires_at: "2026-08-16T06:00:00.000Z",
    action_url: "https://example.invalid/contact/workflows/current#entry=synthetic-preview",
  },
  OWNER_PASSWORD_RESET: {
    expires_at: "2026-08-10T06:00:00.000Z",
    action_url: "https://example.invalid/password-recovery#token=synthetic-preview&code=12345678",
  },
});
