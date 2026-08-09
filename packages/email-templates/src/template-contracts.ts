import type { TemplateCode } from "./template-codes.js";

export type TemplateContract = Readonly<{
  required: readonly string[];
  timeFields: readonly string[];
  urlFields: readonly string[];
  subject: string;
  file: string;
  version: number;
}>;

export const TEMPLATE_CONTRACTS: Readonly<Record<TemplateCode, TemplateContract>> = Object.freeze({
  CONTACT_INVITATION: {
    required: ["owner_name", "contact_name", "expires_at", "action_url"],
    timeFields: ["expires_at"],
    urlFields: ["action_url"],
    subject: "【Digital Legacy System】{{owner_name}} 邀请你成为紧急联系人",
    file: "contact-invitation",
    version: 1,
  },
  CHECKIN_REMINDER: {
    required: ["remaining", "deadline_at", "action_url"],
    timeFields: ["deadline_at"],
    urlFields: ["action_url"],
    subject: "【Digital Legacy System】距离签到截止还有 {{remaining}}",
    file: "checkin-reminder",
    version: 1,
  },
  DEATH_CONFIRMATION_REQUEST: {
    required: ["owner_name", "action_url"],
    timeFields: [],
    urlFields: ["action_url"],
    subject: "【重要】请确认 {{owner_name}} 的联络状态",
    file: "death-confirmation-request",
    version: 1,
  },
  DEATH_CANCELLED_BY_CONTACT: {
    required: ["owner_name", "denier_name", "denier_email", "cancelled_at"],
    timeFields: ["cancelled_at"],
    urlFields: [],
    subject: "【Digital Legacy System】本次确认流程已终止",
    file: "death-cancelled-by-contact",
    version: 1,
  },
  DEATH_CANCELLED_BY_OWNER: {
    required: ["owner_name", "cancelled_at"],
    timeFields: ["cancelled_at"],
    urlFields: [],
    subject: "【Digital Legacy System】{{owner_name}} 已主动终止确认流程",
    file: "death-cancelled-by-owner",
    version: 1,
  },
  DEATH_STAGE2_REMINDER: {
    required: ["remaining", "release_at", "action_url"],
    timeFields: ["release_at"],
    urlFields: ["action_url"],
    subject: "【紧急】数字遗产将在 {{remaining}} 后公开",
    file: "death-stage2-reminder",
    version: 1,
  },
  LEGACY_RELEASED: {
    required: ["owner_name", "published_at", "legacy_url", "download_url", "sha256"],
    timeFields: ["published_at"],
    urlFields: ["legacy_url", "download_url"],
    subject: "【Digital Legacy System】{{owner_name}} 的数字遗产已发布",
    file: "legacy-released",
    version: 1,
  },
  CONTACT_PASSWORD_CHANGE: {
    required: ["owner_name", "expires_at", "action_url"],
    timeFields: ["expires_at"],
    urlFields: ["action_url"],
    subject: "【Digital Legacy System】请修改你的紧急联系人密码",
    file: "contact-password-change",
    version: 1,
  },
  OWNER_RECOVERY_START: {
    required: ["expires_at", "action_url"],
    timeFields: ["expires_at"],
    urlFields: ["action_url"],
    subject: "【Digital Legacy System】确认启动主密码恢复",
    file: "owner-recovery-start",
    version: 1,
  },
  OWNER_RECOVERY_CONTACT_REQUEST: {
    required: ["owner_name", "expires_at", "action_url"],
    timeFields: ["expires_at"],
    urlFields: ["action_url"],
    subject: "【Digital Legacy System】请协助 {{owner_name}} 恢复主密码",
    file: "owner-recovery-contact-request",
    version: 1,
  },
  OWNER_PASSWORD_RESET: {
    required: ["expires_at", "action_url"],
    timeFields: ["expires_at"],
    urlFields: ["action_url"],
    subject: "【Digital Legacy System】联系人门限已达到，请设置新主密码",
    file: "owner-password-reset",
    version: 1,
  },
});
