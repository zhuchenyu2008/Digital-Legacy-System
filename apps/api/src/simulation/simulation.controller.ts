import { Readable } from "node:stream";
import {
  type SessionPrincipal,
  type SimulationContactDecision,
  SimulationError,
  type SimulationMilestone,
} from "@dls/application";
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  StreamableFile,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBody,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiProperty,
  ApiPropertyOptional,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import type { FastifyReply, FastifyRequest } from "fastify";
import { parseSingleByteRange } from "../public/public.controller.js";
import { CsrfGuard } from "../security/csrf.guard.js";
import { OriginGuard } from "../security/origin.guard.js";
import {
  ContactSessionGuard,
  OwnerSessionGuard,
  type SecurityRequest,
} from "../security/session.guard.js";
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

  @ApiPropertyOptional({ type: [String], minItems: 3 })
  public contactIds?: string[];

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

export class SimulationContactDecisionDto {
  @ApiProperty({ type: String, enum: ["ALIVE", "DEATH_LIKELY"] })
  public decision!: SimulationContactDecision;
}

export class CancelSimulationDto {
  @ApiProperty({ type: String, minLength: 1, writeOnly: true })
  public password!: string;
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
  if (error.code === "SIMULATION_OWNER_REAUTH_REQUIRED") {
    throw new UnauthorizedException("current master password reauthentication is required");
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
        ...(body.contactIds === undefined ? {} : { contactIds: body.contactIds }),
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

  @Post(":simulationId/cancel")
  @HttpCode(HttpStatus.OK)
  @UseGuards(OriginGuard, CsrfGuard)
  @ApiBody({ type: CancelSimulationDto })
  @ApiParam({ name: "simulationId", type: String, format: "uuid" })
  @ApiOperation({ summary: "Cancel an isolated synthetic release before its publish lock" })
  public async cancel(
    @Param("simulationId") simulationId: string,
    @Body() body: CancelSimulationDto,
    @Req() request: AuthenticatedRequest,
  ) {
    if (typeof body.password !== "string" || body.password.length === 0) {
      throw new BadRequestException("current master password is required");
    }
    try {
      return {
        data: await this.runtime.ownerCancel({
          simulationId,
          ownerId: ownerId(request),
          password: body.password,
        }),
        requestId: request.id,
      };
    } catch (error) {
      translate(error);
    }
  }

  @Post(":simulationId/publication/lock")
  @HttpCode(HttpStatus.OK)
  @UseGuards(OriginGuard, CsrfGuard)
  @ApiParam({ name: "simulationId", type: String, format: "uuid" })
  @ApiOperation({ summary: "Lock an isolated synthetic publication at its release deadline" })
  public async lock(
    @Param("simulationId") simulationId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    try {
      return {
        data: await this.runtime.lockPublication({ simulationId, ownerId: ownerId(request) }),
        requestId: request.id,
      };
    } catch (error) {
      translate(error);
    }
  }

  @Post(":simulationId/publication/finalize")
  @HttpCode(HttpStatus.OK)
  @UseGuards(OriginGuard, CsrfGuard)
  @ApiParam({ name: "simulationId", type: String, format: "uuid" })
  @ApiOperation({ summary: "Finalize an isolated synthetic publication" })
  public async publish(
    @Param("simulationId") simulationId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    try {
      return {
        data: await this.runtime.finalizePublication({ simulationId, ownerId: ownerId(request) }),
        requestId: request.id,
      };
    } catch (error) {
      translate(error);
    }
  }

  @Get(":simulationId/publication")
  @ApiParam({ name: "simulationId", type: String, format: "uuid" })
  @ApiOperation({ summary: "Read one isolated sanitized simulation publication" })
  public async publication(
    @Param("simulationId") simulationId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    try {
      return {
        data: await this.runtime.publication(simulationId, ownerId(request)),
        requestId: request.id,
      };
    } catch (error) {
      translate(error);
    }
  }

  @Get(":simulationId/publication/package")
  @ApiParam({ name: "simulationId", type: String, format: "uuid" })
  @ApiOperation({ summary: "Download an isolated deterministic simulation ZIP" })
  @ApiProduces("application/zip")
  @ApiResponse({ status: 200, description: "Complete simulation ZIP" })
  @ApiResponse({ status: 206, description: "One byte range of the simulation ZIP" })
  public async download(
    @Param("simulationId") simulationId: string,
    @Headers("range") rangeHeader: string | undefined,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<StreamableFile> {
    const range = parseSingleByteRange(rangeHeader);
    try {
      const opened = await this.runtime.download(simulationId, ownerId(request), range);
      const partial = range !== undefined;
      reply.status(partial ? HttpStatus.PARTIAL_CONTENT : HttpStatus.OK);
      reply.header("accept-ranges", "bytes");
      reply.header("cache-control", "no-store");
      reply.header("content-length", String(opened.bytes));
      reply.header("etag", `"${opened.sha256}"`);
      reply.header("x-content-type-options", "nosniff");
      if (partial) {
        reply.header(
          "content-range",
          `bytes ${range.start}-${range.start + opened.bytes - 1}/${opened.totalBytes}`,
        );
      }
      return new StreamableFile(Readable.from(opened.body), { type: "application/zip" });
    } catch (error) {
      if (error instanceof RangeError) {
        reply.header("content-range", "bytes */*");
        throw new HttpException("simulation byte range is unsatisfiable", 416);
      }
      translate(error);
    }
  }
}

@ApiTags("Contact simulation")
@Controller("contact/simulations")
@UseGuards(ContactSessionGuard, OriginGuard, CsrfGuard)
export class ContactSimulationController {
  public constructor(@Inject(SIMULATION_RUNTIME) private readonly runtime: SimulationRuntime) {}

  @Post(":simulationId/decision")
  @HttpCode(HttpStatus.OK)
  @ApiBody({ type: SimulationContactDecisionDto })
  @ApiParam({ name: "simulationId", type: String, format: "uuid" })
  @ApiOperation({ summary: "Record an authenticated contact decision in an isolated simulation" })
  public async decide(
    @Param("simulationId") simulationId: string,
    @Body() body: SimulationContactDecisionDto,
    @Req() request: AuthenticatedRequest,
  ) {
    if (!new Set<SimulationContactDecision>(["ALIVE", "DEATH_LIKELY"]).has(body.decision)) {
      throw new BadRequestException("unknown simulation contact decision");
    }
    try {
      return {
        data: await this.runtime.contactDecision({
          simulationId,
          contactId: ownerId(request),
          decision: body.decision,
        }),
        requestId: request.id,
      };
    } catch (error) {
      translate(error);
    }
  }
}
