import type { EmailTemplateRendererPort, RenderedEmail } from "@dls/application";
import { renderTemplate, TEMPLATE_CODES, type TemplateCode } from "@dls/email-templates";

const templateCodes = new Set<string>(TEMPLATE_CODES);

export class StrictEmailTemplateRenderer implements EmailTemplateRendererPort {
  public async render(
    templateCode: string,
    context: Readonly<Record<string, unknown>>,
  ): Promise<RenderedEmail> {
    if (!templateCodes.has(templateCode)) throw new Error("Unknown email template code");
    return renderTemplate(templateCode as TemplateCode, context);
  }
}
