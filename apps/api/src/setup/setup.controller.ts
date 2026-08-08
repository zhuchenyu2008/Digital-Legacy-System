import { OwnerSetupError } from "@dls/application";
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
} from "@nestjs/common";
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import type { FastifyRequest } from "fastify";
import { CreateOwnerDto, parseCreateOwner } from "./setup.dto.js";
import { SETUP_RUNTIME, type SetupRuntime } from "./setup.runtime.js";

@ApiTags("Setup")
@Controller("setup")
export class SetupController {
  public constructor(@Inject(SETUP_RUNTIME) private readonly runtime: SetupRuntime) {}

  @Get("status")
  @ApiOperation({ summary: "Get non-sensitive initialization status" })
  @ApiResponse({ status: 200, description: "Initialization status" })
  public async status(@Req() request: FastifyRequest) {
    return { data: await this.runtime.getStatus(), requestId: request.id };
  }

  @Post("owner")
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "Create the singleton owner exactly once" })
  @ApiBody({ type: CreateOwnerDto })
  @ApiResponse({ status: 201, description: "Owner created and signed in" })
  public async create(@Body() body: CreateOwnerDto, @Req() request: FastifyRequest) {
    try {
      const result = await this.runtime.createOwner(parseCreateOwner(body, request.id));
      return {
        data: {
          ownerId: result.ownerId,
          vaultId: result.vaultId,
          ...(result.session === undefined
            ? {}
            : {
                role: "OWNER",
                session: {
                  csrfToken: result.session.csrfToken,
                  idleExpiresAt: result.session.principal.idleExpiresAt,
                  absoluteExpiresAt: result.session.principal.absoluteExpiresAt,
                },
              }),
        },
        requestId: request.id,
      };
    } catch (error) {
      if (error instanceof OwnerSetupError) {
        throw new BadRequestException({ code: error.code, message: error.message });
      }
      throw error;
    }
  }
}
