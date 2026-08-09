import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBody, ApiOperation, ApiParam, ApiQuery, ApiTags } from "@nestjs/swagger";
import { CsrfGuard } from "../security/csrf.guard.js";
import { OriginGuard } from "../security/origin.guard.js";
import { OwnerSessionGuard } from "../security/session.guard.js";
import { AuditDetailDto, parseAuditDetail } from "./audit.dto.js";
import { AUDIT_RUNTIME, type AuditRuntime } from "./audit.runtime.js";

@ApiTags("Owner private audit")
@Controller("owner")
@UseGuards(OwnerSessionGuard)
export class AuditController {
  public constructor(@Inject(AUDIT_RUNTIME) private readonly runtime: AuditRuntime) {}

  @Get("audit-events")
  @ApiOperation({ summary: "Read a redacted page of immutable private audit events" })
  @ApiQuery({ name: "eventType", required: false, type: String })
  @ApiQuery({ name: "result", required: false, type: String })
  @ApiQuery({ name: "cursor", required: false, type: String })
  @ApiQuery({ name: "limit", required: false, type: Number, minimum: 1, maximum: 100 })
  public list(
    @Query("eventType") eventType?: string,
    @Query("result") result?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limitText?: string,
  ) {
    const parsedLimit =
      limitText === undefined || limitText.length === 0 ? undefined : Number(limitText);
    return this.runtime.list({
      ...(eventType === undefined ? {} : { eventType }),
      ...(result === undefined ? {} : { result }),
      ...(cursor === undefined ? {} : { cursor }),
      ...(parsedLimit === undefined ? {} : { limit: parsedLimit }),
    });
  }

  @Get("audit-integrity")
  @ApiOperation({ summary: "Verify the complete private audit hash chain" })
  public integrity() {
    return this.runtime.integrity();
  }

  @Post("audit-events/:eventId/detail")
  @HttpCode(HttpStatus.OK)
  @UseGuards(OriginGuard, CsrfGuard)
  @ApiParam({ name: "eventId", type: String, format: "uuid" })
  @ApiBody({ type: AuditDetailDto })
  @ApiOperation({ summary: "Reauthenticate before reading digest-only audit detail" })
  public detail(@Param("eventId") eventId: string, @Body() body: AuditDetailDto) {
    return this.runtime.detail(eventId, parseAuditDetail(body).password);
  }
}
