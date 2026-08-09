import { Body, Controller, Inject, Param, Post, Req, Res, UseGuards } from "@nestjs/common";
import { ApiBody, ApiOperation, ApiParam, ApiTags } from "@nestjs/swagger";
import type { FastifyReply, FastifyRequest } from "fastify";
import { CsrfGuard } from "../security/csrf.guard.js";
import { OriginGuard } from "../security/origin.guard.js";
import { OwnerSessionGuard } from "../security/session.guard.js";
import { EmailTemplatePreviewDto, parseEmailTemplatePreview } from "./email-templates.dto.js";
import { EMAIL_TEMPLATE_RUNTIME, type EmailTemplateRuntime } from "./email-templates.runtime.js";

@ApiTags("Owner email templates")
@Controller("owner/email-templates")
@UseGuards(OwnerSessionGuard, OriginGuard, CsrfGuard)
export class EmailTemplatesController {
  public constructor(
    @Inject(EMAIL_TEMPLATE_RUNTIME) private readonly runtime: EmailTemplateRuntime,
  ) {}

  @Post(":templateCode/preview")
  @ApiParam({ name: "templateCode", type: String })
  @ApiBody({ type: EmailTemplatePreviewDto })
  @ApiOperation({ summary: "Render an owner-authorized no-store preview without sending mail" })
  public async preview(
    @Param("templateCode") templateCode: string,
    @Body() body: EmailTemplatePreviewDto,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    reply.header("cache-control", "no-store");
    reply.header("x-content-type-options", "nosniff");
    return {
      data: await this.runtime.preview(templateCode, parseEmailTemplatePreview(body)),
      requestId: request.id,
    };
  }
}
