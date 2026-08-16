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
import { ApiBody, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from "@nestjs/swagger";
import type { FastifyRequest } from "fastify";
import { CsrfGuard } from "../security/csrf.guard.js";
import { OriginGuard } from "../security/origin.guard.js";
import { OwnerRateLimitGuard } from "../security/rate-limit.guard.js";
import { OwnerSessionGuard, type SecurityRequest } from "../security/session.guard.js";
import { CancelDeathWorkflowDto, parseCancelDeathWorkflow } from "./workflows.dto.js";
import { WORKFLOW_RUNTIME, type WorkflowRuntime } from "./workflows.runtime.js";

type OwnerActionRequest = FastifyRequest &
  SecurityRequest & {
    user?: Readonly<{ actorId?: string }>;
  };

@ApiTags("Owner workflow actions")
@Controller("owner/workflows")
@UseGuards(OwnerSessionGuard, OwnerRateLimitGuard, OriginGuard, CsrfGuard)
export class OwnerActionsController {
  public constructor(@Inject(WORKFLOW_RUNTIME) private readonly runtime: WorkflowRuntime) {}

  @Post(":workflowId/cancel")
  @HttpCode(HttpStatus.OK)
  @ApiBody({ type: CancelDeathWorkflowDto })
  @ApiParam({ name: "workflowId", type: String })
  @ApiOperation({
    summary: "Cancel a pending death release after master-password reauthentication",
  })
  @ApiOkResponse({ description: "The pending death release was cancelled before publish lock" })
  public async cancel(
    @Param("workflowId") workflowId: string,
    @Body() body: CancelDeathWorkflowDto,
    @Req() request: OwnerActionRequest,
  ) {
    const ownerId = request.user?.actorId;
    if (ownerId === undefined || ownerId.length === 0) {
      throw new UnauthorizedException("authentication is required");
    }
    try {
      const result = await this.runtime.cancelDeath({
        workflowId,
        ownerId,
        ...parseCancelDeathWorkflow(body),
        requestId: request.id,
      });
      return { data: result, requestId: request.id };
    } catch (error) {
      if (error instanceof WorkflowError) {
        throw new HttpException({ code: error.code, message: error.message }, error.status);
      }
      throw error;
    }
  }
}
