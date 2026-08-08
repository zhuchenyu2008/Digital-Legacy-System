import { ContactUseCaseError } from "@dls/application";
import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ContactLoginDto, parseContactLogin } from "./contact.dto.js";
import { CONTACT_RUNTIME, type ContactRuntime } from "./contact.runtime.js";

function setContactCookie(response: FastifyReply, token: string): void {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.header(
    "set-cookie",
    `__Host-dls-contact=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict${secure}`,
  );
}

@ApiTags("Contact authentication")
@Controller("auth/contact")
export class ContactAuthController {
  public constructor(@Inject(CONTACT_RUNTIME) private readonly runtime: ContactRuntime) {}

  @Post("login")
  @HttpCode(HttpStatus.OK)
  @ApiBody({ type: ContactLoginDto })
  @ApiOperation({ summary: "Login an emergency contact" })
  @ApiResponse({ status: 200, description: "Contact session created" })
  public async login(
    @Body() body: ContactLoginDto,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    try {
      const result = await this.runtime.login({
        ...parseContactLogin(body),
        requestId: request.id,
        ...(request.ip === undefined ? {} : { ip: request.ip }),
        ...(request.headers["user-agent"] === undefined
          ? {}
          : { userAgent: request.headers["user-agent"] }),
      });
      setContactCookie(response, result.session.token);
      return {
        data: {
          role: result.role,
          contactId: result.contactId,
          status: result.status,
          cryptoMaterial: result.cryptoMaterial,
          session: {
            csrfToken: result.session.csrfToken,
            idleExpiresAt: result.session.principal.idleExpiresAt,
            absoluteExpiresAt: result.session.principal.absoluteExpiresAt,
          },
        },
        requestId: request.id,
      };
    } catch (error) {
      if (error instanceof ContactUseCaseError) {
        throw new HttpException({ code: error.code, message: error.message }, error.status);
      }
      throw error;
    }
  }
}
