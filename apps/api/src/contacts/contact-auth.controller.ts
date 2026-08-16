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
  UseGuards,
} from "@nestjs/common";
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import type { FastifyReply, FastifyRequest } from "fastify";
import { CsrfGuard } from "../security/csrf.guard.js";
import { ContactRateLimitGuard } from "../security/rate-limit.guard.js";
import { ContactSessionGuard } from "../security/session.guard.js";
import { setSessionCookies } from "../security/session-cookies.js";
import {
  ChangeContactPasswordDto,
  ContactLoginDto,
  parseChangeContactPassword,
  parseContactLogin,
} from "./contact.dto.js";
import { CONTACT_RUNTIME, type ContactRuntime } from "./contact.runtime.js";

@ApiTags("Contact authentication")
@Controller("auth/contact")
export class ContactAuthController {
  public constructor(@Inject(CONTACT_RUNTIME) private readonly runtime: ContactRuntime) {}

  @Post("login")
  @HttpCode(HttpStatus.OK)
  @UseGuards(ContactRateLimitGuard)
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
      setSessionCookies(response, "CONTACT", result.session.token, result.session.csrfToken);
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

@ApiTags("Contact password")
@Controller("contacts/password-change")
export class ContactPasswordController {
  public constructor(@Inject(CONTACT_RUNTIME) private readonly runtime: ContactRuntime) {}

  @Post("complete")
  @UseGuards(ContactSessionGuard, ContactRateLimitGuard, CsrfGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBody({ type: ChangeContactPasswordDto })
  @ApiOperation({ summary: "Rotate the contact password and wrapped private key" })
  public async complete(
    @Body() body: ChangeContactPasswordDto,
    @Req() request: FastifyRequest & { sessionToken?: string },
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    try {
      const result = await this.runtime.changePassword({
        ...parseChangeContactPassword(body),
        requestId: request.id,
        ...(request.sessionToken === undefined
          ? {}
          : { currentSessionToken: request.sessionToken }),
      });
      setSessionCookies(response, "CONTACT", result.session.token, result.session.csrfToken);
      return {
        data: {
          contactId: result.contactId,
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
