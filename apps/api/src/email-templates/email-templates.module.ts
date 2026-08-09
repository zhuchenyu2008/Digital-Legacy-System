import { Module } from "@nestjs/common";
import { SecurityModule } from "../security/security.module.js";
import { EmailTemplatesController } from "./email-templates.controller.js";
import { createEmailTemplateRuntime, EMAIL_TEMPLATE_RUNTIME } from "./email-templates.runtime.js";

@Module({
  imports: [SecurityModule],
  controllers: [EmailTemplatesController],
  providers: [{ provide: EMAIL_TEMPLATE_RUNTIME, useFactory: createEmailTemplateRuntime }],
})
export class EmailTemplatesModule {}
