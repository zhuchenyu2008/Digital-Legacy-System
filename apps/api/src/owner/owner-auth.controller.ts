import { OwnerLoginError, OwnerPasswordChangeError, type SessionPrincipal } from "@dls/application";
import {
  Body,
  Controller,
  Get,
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
import { OwnerRateLimitGuard } from "../security/rate-limit.guard.js";
import { OwnerSessionGuard, type SecurityRequest } from "../security/session.guard.js";
import { clearSessionCookies, setSessionCookies } from "../security/session-cookies.js";
import {
  ChangeOwnerPasswordDto,
  OwnerLoginDto,
  parseOwnerLogin,
  parseOwnerPasswordChange,
} from "./owner.dto.js";
import { OWNER_RUNTIME, type OwnerRuntime } from "./owner.runtime.js";

type AuthenticatedRequest = FastifyRequest & SecurityRequest & { user?: SessionPrincipal };

@ApiTags("Owner authentication")
@Controller("auth")
export class OwnerAuthController {
  public constructor(@Inject(OWNER_RUNTIME) private readonly runtime: OwnerRuntime) {}

  @Post("owner/login")
  @HttpCode(HttpStatus.OK)
  @UseGuards(OwnerRateLimitGuard)
  @ApiOperation({ summary: "Login the singleton owner and record a check-in" })
  @ApiBody({ type: OwnerLoginDto })
  @ApiResponse({ status: 200, description: "Owner session created" })
  public async login(
    @Body() body: OwnerLoginDto,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    try {
      const parsed = parseOwnerLogin(body);
      const result = await this.runtime.login({
        ...parsed,
        requestId: request.id,
        ...(request.ip === undefined ? {} : { ip: request.ip }),
        ...(request.headers["user-agent"] === undefined
          ? {}
          : { userAgent: request.headers["user-agent"] }),
      });
      setSessionCookies(response, "OWNER", result.session.token, result.session.csrfToken);
      return {
        data: {
          role: result.role,
          checkedIn: result.checkedIn,
          beijingDate: result.beijingDate,
          nextDeadlineAt: result.nextDeadlineAt,
          workflowCancellation: result.workflowCancellation,
          session: {
            csrfToken: result.session.csrfToken,
            idleExpiresAt: result.session.principal.idleExpiresAt,
            absoluteExpiresAt: result.session.principal.absoluteExpiresAt,
          },
        },
        requestId: request.id,
      };
    } catch (error) {
      if (error instanceof OwnerLoginError)
        throw new HttpException({ code: error.code, message: error.message }, error.status);
      throw error;
    }
  }

  @Get("session")
  @UseGuards(OwnerSessionGuard)
  @ApiOperation({ summary: "Read the current owner session" })
  public async session(@Req() request: AuthenticatedRequest) {
    const token = request.sessionToken;
    if (token === undefined)
      throw new HttpException("authentication is required", HttpStatus.UNAUTHORIZED);
    return { data: await this.runtime.session(token), requestId: request.id };
  }

  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(OwnerSessionGuard, CsrfGuard)
  @ApiOperation({ summary: "Revoke the current owner session" })
  public async logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: FastifyReply,
  ): Promise<void> {
    if (request.sessionToken !== undefined) await this.runtime.logout(request.sessionToken);
    clearSessionCookies(response, "OWNER");
  }

  @Post("owner/password-change")
  @UseGuards(OwnerSessionGuard, OwnerRateLimitGuard, CsrfGuard)
  @ApiBody({ type: ChangeOwnerPasswordDto })
  @ApiOperation({ summary: "Change the owner password and rotate the session" })
  public async changePassword(
    @Body() body: ChangeOwnerPasswordDto,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    const ownerId = request.user?.actorId;
    if (ownerId === undefined)
      throw new HttpException("authentication is required", HttpStatus.UNAUTHORIZED);
    try {
      const result = await this.runtime.changePassword({
        ...parseOwnerPasswordChange(body),
        ownerId,
        requestId: request.id,
      });
      setSessionCookies(response, "OWNER", result.session.token, result.session.csrfToken);
      return {
        data: {
          credentialVersion: result.credentialVersion,
          session: {
            csrfToken: result.session.csrfToken,
            idleExpiresAt: result.session.principal.idleExpiresAt,
            absoluteExpiresAt: result.session.principal.absoluteExpiresAt,
          },
        },
        requestId: request.id,
      };
    } catch (error) {
      if (error instanceof OwnerPasswordChangeError)
        throw new HttpException({ code: error.code, message: error.message }, error.status);
      throw error;
    }
  }
}
