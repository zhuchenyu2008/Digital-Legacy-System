import {
  ArmOwnerError,
  OwnerLoginError,
  OwnerSettingsError,
  type SessionPrincipal,
} from "@dls/application";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import type { FastifyRequest } from "fastify";
import { CsrfGuard } from "../security/csrf.guard.js";
import { OwnerSessionGuard, type SecurityRequest } from "../security/session.guard.js";
import {
  OwnerArmDto,
  OwnerCheckInDto,
  parseOwnerArm,
  parseOwnerCheckIn,
  parseOwnerSettings,
  UpdateOwnerSettingsDto,
} from "./owner.dto.js";
import { OWNER_RUNTIME, type OwnerRuntime } from "./owner.runtime.js";

type OwnerRequest = FastifyRequest & SecurityRequest & { user?: SessionPrincipal };

@ApiTags("Owner")
@Controller("owner")
@UseGuards(OwnerSessionGuard)
export class OwnerController {
  public constructor(@Inject(OWNER_RUNTIME) private readonly runtime: OwnerRuntime) {}

  @Get("settings")
  @ApiOperation({ summary: "Read sanitized owner settings" })
  public async settings(@Req() request: OwnerRequest) {
    return { data: await this.runtime.getSettings(), requestId: request.id };
  }

  @Patch("settings")
  @UseGuards(OwnerSessionGuard, CsrfGuard)
  @ApiBody({ type: UpdateOwnerSettingsDto })
  @ApiOperation({ summary: "Update owner settings after password reauthentication" })
  public async updateSettings(@Body() body: UpdateOwnerSettingsDto, @Req() request: OwnerRequest) {
    const ownerId = request.user?.actorId;
    if (ownerId === undefined)
      throw new HttpException("authentication is required", HttpStatus.UNAUTHORIZED);
    try {
      return {
        data: await this.runtime.updateSettings({
          ...parseOwnerSettings(body),
          ownerId,
          requestId: request.id,
        }),
        requestId: request.id,
      };
    } catch (error) {
      if (error instanceof OwnerSettingsError)
        throw new HttpException({ code: error.code, message: error.message }, error.status);
      throw error;
    }
  }

  @Post("check-ins")
  @HttpCode(HttpStatus.OK)
  @UseGuards(OwnerSessionGuard, CsrfGuard)
  @ApiBody({ type: OwnerCheckInDto })
  @ApiOperation({ summary: "Explicitly reauthenticate and record an owner check-in" })
  @ApiResponse({ status: 200, description: "Check-in recorded" })
  public async checkIn(@Body() body: OwnerCheckInDto, @Req() request: OwnerRequest) {
    const ownerId = request.user?.actorId;
    if (ownerId === undefined)
      throw new HttpException("authentication is required", HttpStatus.UNAUTHORIZED);
    try {
      return {
        data: await this.runtime.checkIn({
          ...parseOwnerCheckIn(body),
          ownerId,
          requestId: request.id,
        }),
        requestId: request.id,
      };
    } catch (error) {
      if (error instanceof OwnerLoginError)
        throw new HttpException({ code: error.code, message: error.message }, error.status);
      throw error;
    }
  }

  @Get("check-in-schedule")
  @ApiOperation({ summary: "Read the current check-in schedule" })
  public async schedule(@Req() request: OwnerRequest) {
    return { data: await this.runtime.getSchedule(), requestId: request.id };
  }

  @Post("arm")
  @UseGuards(OwnerSessionGuard, CsrfGuard)
  @ApiBody({ type: OwnerArmDto })
  @ApiOperation({ summary: "Atomically accept irreversible risk and arm the owner system" })
  public async arm(@Body() body: OwnerArmDto, @Req() request: OwnerRequest) {
    const ownerId = request.user?.actorId;
    if (ownerId === undefined)
      throw new HttpException("authentication is required", HttpStatus.UNAUTHORIZED);
    try {
      return {
        data: await this.runtime.arm({ ...parseOwnerArm(body), ownerId, requestId: request.id }),
        requestId: request.id,
      };
    } catch (error) {
      if (error instanceof ArmOwnerError)
        throw new HttpException({ code: error.code, message: error.message }, error.status);
      throw error;
    }
  }

  @Post("smtp-settings/test")
  @UseGuards(OwnerSessionGuard, CsrfGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Send a safe SMTP connectivity test to the owner primary address" })
  public async smtpTest(@Req() request: OwnerRequest) {
    const ownerId = request.user?.actorId;
    if (ownerId === undefined)
      throw new HttpException("authentication is required", HttpStatus.UNAUTHORIZED);
    return {
      data: await this.runtime.smtpTest({ ownerId, requestId: request.id }),
      requestId: request.id,
    };
  }
}
