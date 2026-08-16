import { WorkflowError } from "@dls/application";
import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import {
  ApiAcceptedResponse,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from "@nestjs/swagger";
import type { FastifyRequest } from "fastify";
import { CsrfGuard } from "../security/csrf.guard.js";
import { OriginGuard } from "../security/origin.guard.js";
import { ContactRateLimitGuard } from "../security/rate-limit.guard.js";
import { ContactSessionGuard, type SecurityRequest } from "../security/session.guard.js";
import {
  AffirmDeathDto,
  ConfirmAliveDto,
  parseAffirmDeath,
  parseConfirmAlive,
} from "./workflows.dto.js";
import { WORKFLOW_RUNTIME, type WorkflowRuntime } from "./workflows.runtime.js";

type ContactActionRequest = FastifyRequest &
  SecurityRequest & {
    user?: Readonly<{ actorId?: string }>;
  };

@ApiTags("Contact workflow actions")
@Controller("contact/workflows")
@UseGuards(ContactSessionGuard, ContactRateLimitGuard, OriginGuard, CsrfGuard)
export class ContactActionsController {
  public constructor(@Inject(WORKFLOW_RUNTIME) private readonly runtime: WorkflowRuntime) {}

  @Post(":workflowId/confirm-death")
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiBody({ type: AffirmDeathDto })
  @ApiParam({ name: "workflowId", type: String })
  @ApiOperation({ summary: "Submit a reauthenticated affirmative decision and sealed share" })
  @ApiAcceptedResponse({ description: "The sealed fragment is pending worker validation" })
  public async affirm(
    @Param("workflowId") workflowId: string,
    @Body() body: AffirmDeathDto,
    @Req() request: ContactActionRequest,
  ) {
    try {
      const result = await this.runtime.affirmDeath({
        workflowId,
        contactId: this.actorId(request),
        ...parseAffirmDeath(body),
        requestId: request.id,
      });
      return { data: result, requestId: request.id };
    } catch (error) {
      this.rethrow(error);
    }
  }

  @Post(":workflowId/confirm-alive")
  @HttpCode(HttpStatus.OK)
  @ApiBody({ type: ConfirmAliveDto })
  @ApiParam({ name: "workflowId", type: String })
  @ApiOperation({ summary: "Cancel a death workflow with an exact alive confirmation" })
  @ApiOkResponse({ description: "The workflow was cancelled and check-in was rescheduled" })
  public async alive(
    @Param("workflowId") workflowId: string,
    @Body() body: ConfirmAliveDto,
    @Req() request: ContactActionRequest,
  ) {
    try {
      const result = await this.runtime.confirmAlive({
        workflowId,
        contactId: this.actorId(request),
        ...parseConfirmAlive(body),
        requestId: request.id,
      });
      return { data: result, requestId: request.id };
    } catch (error) {
      this.rethrow(error);
    }
  }

  private actorId(request: ContactActionRequest): string {
    const actorId = request.user?.actorId;
    if (actorId === undefined || actorId.length === 0) {
      throw new UnauthorizedException("authentication is required");
    }
    return actorId;
  }

  private rethrow(error: unknown): never {
    if (error instanceof WorkflowError) {
      throw new HttpException({ code: error.code, message: error.message }, error.status);
    }
    throw error;
  }
}
