import { ShareGenerationError } from "@dls/application";
import {
  Body,
  Controller,
  Get,
  HttpException,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBody, ApiOperation, ApiParam, ApiTags } from "@nestjs/swagger";
import type { FastifyRequest } from "fastify";
import { CsrfGuard } from "../security/csrf.guard.js";
import { OriginGuard } from "../security/origin.guard.js";
import { OwnerSessionGuard, type SecurityRequest } from "../security/session.guard.js";
import {
  ActivateShareGenerationDto,
  CreateShareGenerationDto,
  parseActivateShareGeneration,
  parseCreateShareGeneration,
  parseUploadShareGeneration,
  UploadShareGenerationDto,
} from "./share-generation.dto.js";
import {
  SHARE_GENERATION_RUNTIME,
  type ShareGenerationRuntime,
} from "./share-generation.runtime.js";

type OwnerRequest = FastifyRequest & SecurityRequest & { user?: Readonly<{ actorId?: string }> };

@ApiTags("Share generations")
@Controller("owner/vault/share-generations")
export class ShareGenerationController {
  public constructor(
    @Inject(SHARE_GENERATION_RUNTIME) private readonly runtime: ShareGenerationRuntime,
  ) {}

  @Post()
  @UseGuards(OwnerSessionGuard, OriginGuard, CsrfGuard)
  @ApiBody({ type: CreateShareGenerationDto })
  @ApiOperation({ summary: "Create a share generation draft and return the roster snapshot" })
  public async create(@Body() body: CreateShareGenerationDto, @Req() request: OwnerRequest) {
    const ownerId = this.ownerId(request);
    return this.run(() =>
      this.runtime.create({
        ...parseCreateShareGeneration(body),
        ownerId,
        requestId: request.id,
      }),
    );
  }

  @Post(":generationId/upload")
  @UseGuards(OwnerSessionGuard, OriginGuard, CsrfGuard)
  @ApiParam({ name: "generationId", type: String, format: "uuid" })
  @ApiBody({ type: UploadShareGenerationDto })
  @ApiOperation({ summary: "Validate and store the encrypted shares for a draft" })
  public async upload(
    @Param("generationId") generationId: string,
    @Body() body: UploadShareGenerationDto,
    @Req() request: OwnerRequest,
  ) {
    const ownerId = this.ownerId(request);
    return this.run(() =>
      this.runtime.upload({
        ...parseUploadShareGeneration(body),
        generationId,
        ownerId,
        requestId: request.id,
      }),
    );
  }

  @Post(":generationId/activate")
  @UseGuards(OwnerSessionGuard, OriginGuard, CsrfGuard)
  @ApiParam({ name: "generationId", type: String, format: "uuid" })
  @ApiBody({ type: ActivateShareGenerationDto })
  @ApiOperation({ summary: "Atomically activate a complete share generation" })
  public async activate(
    @Param("generationId") generationId: string,
    @Body() body: ActivateShareGenerationDto,
    @Req() request: OwnerRequest,
  ) {
    const ownerId = this.ownerId(request);
    return this.run(() =>
      this.runtime.activate({
        ...parseActivateShareGeneration(body),
        generationId,
        ownerId,
        requestId: request.id,
      }),
    );
  }

  @Get(":generationId/material")
  @UseGuards(OwnerSessionGuard)
  @ApiParam({ name: "generationId", type: String, format: "uuid" })
  @ApiOperation({ summary: "Read public material needed to build a share generation" })
  public async material(@Param("generationId") generationId: string, @Req() request: OwnerRequest) {
    this.ownerId(request);
    return this.run(() => this.runtime.material(generationId));
  }

  private ownerId(request: OwnerRequest): string {
    const ownerId = request.user?.actorId;
    if (ownerId === undefined || ownerId.length === 0)
      throw new HttpException("authentication is required", 401);
    return ownerId;
  }

  private async run<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof ShareGenerationError) {
        throw new HttpException({ code: error.code, message: error.message }, error.status);
      }
      throw error;
    }
  }
}
