import { Controller, Get, Inject, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { OwnerSessionGuard } from "../security/session.guard.js";
import {
  OWNER_SYSTEM_HEALTH_RUNTIME,
  type OwnerSystemHealthRuntime,
} from "./owner-system-health.runtime.js";

@ApiTags("Owner system health")
@Controller("owner/system-health")
@UseGuards(OwnerSessionGuard)
export class OwnerSystemHealthController {
  public constructor(
    @Inject(OWNER_SYSTEM_HEALTH_RUNTIME) private readonly runtime: OwnerSystemHealthRuntime,
  ) {}

  @Get()
  @ApiOperation({ summary: "Read redacted operational health categories" })
  public read() {
    return this.runtime.read();
  }
}
