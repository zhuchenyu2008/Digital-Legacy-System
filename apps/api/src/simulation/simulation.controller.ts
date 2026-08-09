import { type SessionPrincipal, SimulationError, type SimulationMilestone } from "@dls/application";
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { ApiBody, ApiHeader, ApiOperation, ApiParam, ApiProperty, ApiTags } from "@nestjs/swagger";
import type { FastifyRequest } from "fastify";
import { CsrfGuard } from "../security/csrf.guard.js";
import { OriginGuard } from "../security/origin.guard.js";
import { OwnerSessionGuard, type SecurityRequest } from "../security/session.guard.js";
import { SIMULATION_RUNTIME, type SimulationRuntime } from "./simulation.runtime.js";

const TARGETS = new Set<SimulationMilestone>([
  "CHECKIN_DUE",
  "CONTACT_DECISION",
  "RECOVERY_THRESHOLD",
  "RELEASE_COUNTDOWN",
  "SMTP_RETRY",
  "PUBLICATION",
]);

export class CreateSimulationDto {
  @ApiProperty({ type: String, format: "uuid" })
  public simulationId!: string;

  @ApiProperty({ type: String, format: "email" })
  public ownerEmail!: string;

  @ApiProperty({ type: [String], minItems: 1 })
  public contactEmails!: string[];

  @ApiProperty({ type: String, format: "date-time" })
  public startAt!: string;
}

export class AdvanceSimulationDto {
  @ApiProperty({
    type: String,
    enum: [
      "CHECKIN_DUE",
      "CONTACT_DECISION",
      "RECOVERY_THRESHOLD",
      "RELEASE_COUNTDOWN",
      "SMTP_RETRY",
      "PUBLICATION",
    ],
  })
  public target!: SimulationMilestone;
}

type AuthenticatedRequest = FastifyRequest & SecurityRequest & { user?: SessionPrincipal };

function ownerId(request: AuthenticatedRequest): string {
  const value = request.user?.actorId;
  if (value === undefined) throw new UnauthorizedException("authentication is required");
  return value;
}

function translate(error: unknown): never {
  if (!(error instanceof SimulationError)) throw error;
  if (error.code === "SIMULATION_DISABLED" || error.code === "SIMULATION_NOT_FOUND") {
    throw new NotFoundException("resource is unavailable");
  }
  if (error.code === "SIMULATION_FORBIDDEN") {
    throw new ForbiddenException("resource is unavailable");
  }
  throw new BadRequestException({ code: error.code, message: error.message });
}

@ApiTags("Owner simulation")
@Controller("owner/simulations")
@UseGuards(OwnerSessionGuard)
export class SimulationController {
  public constructor(@Inject(SIMULATION_RUNTIME) private readonly runtime: SimulationRuntime) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(OriginGuard, CsrfGuard)
  @ApiBody({ type: CreateSimulationDto })
  @ApiOperation({ summary: "Create an isolated synthetic workflow simulation" })
  public async create(@Body() body: CreateSimulationDto, @Req() request: AuthenticatedRequest) {
    try {
      const data = await this.runtime.create({
        simulationId: body.simulationId,
        ownerId: ownerId(request),
        ownerEmail: body.ownerEmail,
        contactEmails: body.contactEmails,
        startAt: body.startAt,
      });
      return { data, requestId: request.id };
    } catch (error) {
      translate(error);
    }
  }

  @Get(":simulationId")
  @ApiParam({ name: "simulationId", type: String, format: "uuid" })
  @ApiOperation({ summary: "Read one owner-scoped workflow simulation" })
  public async get(
    @Param("simulationId") simulationId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    try {
      return {
        data: await this.runtime.get(simulationId, ownerId(request)),
        requestId: request.id,
      };
    } catch (error) {
      translate(error);
    }
  }

  @Post(":simulationId/advance")
  @HttpCode(HttpStatus.OK)
  @UseGuards(OriginGuard, CsrfGuard)
  @ApiBody({ type: AdvanceSimulationDto })
  @ApiHeader({ name: "idempotency-key", required: true })
  @ApiParam({ name: "simulationId", type: String, format: "uuid" })
  @ApiOperation({ summary: "Advance isolated virtual time to a deterministic milestone" })
  public async advance(
    @Param("simulationId") simulationId: string,
    @Body() body: AdvanceSimulationDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    if (idempotencyKey === undefined || idempotencyKey.trim().length < 8) {
      throw new BadRequestException("idempotency-key must contain at least eight characters");
    }
    if (!TARGETS.has(body.target)) throw new BadRequestException("unknown simulation target");
    try {
      return {
        data: await this.runtime.advance({
          simulationId,
          ownerId: ownerId(request),
          idempotencyKey,
          target: body.target,
        }),
        requestId: request.id,
      };
    } catch (error) {
      translate(error);
    }
  }

  @Post(":simulationId/reset")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(OriginGuard, CsrfGuard)
  @ApiParam({ name: "simulationId", type: String, format: "uuid" })
  @ApiOperation({ summary: "Reset and remove one isolated workflow simulation" })
  public async reset(
    @Param("simulationId") simulationId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    try {
      await this.runtime.reset(simulationId, ownerId(request));
    } catch (error) {
      translate(error);
    }
  }
}
