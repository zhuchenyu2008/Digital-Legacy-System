import {
  renderTemplate,
  SYNTHETIC_TEMPLATE_CONTEXTS,
  TEMPLATE_CODES,
  type TemplateCode,
} from "@dls/email-templates";
import { BadRequestException } from "@nestjs/common";
import type { EmailTemplatePreviewInput } from "./email-templates.dto.js";

export const EMAIL_TEMPLATE_RUNTIME = Symbol("DLS_EMAIL_TEMPLATE_RUNTIME");

export interface EmailTemplateRuntime {
  preview(
    templateCode: string,
    input: EmailTemplatePreviewInput,
  ): ReturnType<typeof renderTemplate>;
}

function parseTemplateCode(value: string): TemplateCode {
  if (!TEMPLATE_CODES.includes(value as TemplateCode)) {
    throw new BadRequestException("templateCode is not supported");
  }
  return value as TemplateCode;
}

export class StrictEmailTemplateRuntime implements EmailTemplateRuntime {
  public preview(templateCode: string, input: EmailTemplatePreviewInput) {
    const code = parseTemplateCode(templateCode);
    const context = input.mode === "synthetic" ? SYNTHETIC_TEMPLATE_CONTEXTS[code] : input.data;
    return renderTemplate(code, context, input.override);
  }
}

export function createEmailTemplateRuntime(): EmailTemplateRuntime {
  return new StrictEmailTemplateRuntime();
}
