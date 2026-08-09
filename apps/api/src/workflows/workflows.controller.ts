import { Controller, Get, Inject, Req, UnauthorizedException, UseGuards } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { FastifyRequest } from "fastify";
import {
  ContactSessionGuard,
  OwnerSessionGuard,
  type SecurityRequest,
} from "../security/session.guard.js";
import { ContactWorkflowDto, OwnerWorkflowDto } from "./workflows.dto.js";
import { WORKFLOW_RUNTIME, type WorkflowRuntime } from "./workflows.runtime.js";

type WorkflowRequest = FastifyRequest &
  SecurityRequest & {
    user?: Readonly<{ actorId?: string }>;
  };

@ApiTags("Workflows")
@Controller()
export class WorkflowsController {
  public constructor(@Inject(WORKFLOW_RUNTIME) private readonly runtime: WorkflowRuntime) {}

  @Get("owner/workflows/current")
  @UseGuards(OwnerSessionGuard)
  @ApiOperation({ summary: "Read the current workflow with its private owner snapshot" })
  @ApiOkResponse({ type: OwnerWorkflowDto })
  public ownerCurrent(@Req() request: WorkflowRequest) {
    this.actorId(request);
    return this.runtime.ownerCurrent();
  }

  @Get("contact/workflows/current")
  @UseGuards(ContactSessionGuard)
  @ApiOperation({ summary: "Read only the authenticated contact's workflow participation" })
  @ApiOkResponse({ type: ContactWorkflowDto })
  public contactCurrent(@Req() request: WorkflowRequest) {
    return this.runtime.contactCurrent(this.actorId(request));
  }

  private actorId(request: WorkflowRequest): string {
    const actorId = request.user?.actorId;
    if (actorId === undefined || actorId.length === 0) {
      throw new UnauthorizedException("authentication is required");
    }
    return actorId;
  }
}
