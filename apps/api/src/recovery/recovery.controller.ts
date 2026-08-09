import { RecoveryError } from "@dls/application";
import { encodeBase64Url } from "@dls/crypto/node";
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
import { ContactSessionGuard, type SecurityRequest } from "../security/session.guard.js";
import {
  ApproveRecoveryDto,
  CompleteRecoveryDto,
  CreateRecoveryMaterialDto,
  parseApproveRecovery,
  parseCompleteRecovery,
  parseCreateRecoveryMaterial,
  parseStartRecovery,
  StartRecoveryDto,
} from "./recovery.dto.js";
import { RECOVERY_RUNTIME, type RecoveryRuntime } from "./recovery.runtime.js";

type ApiRequest = FastifyRequest & SecurityRequest & { user?: Readonly<{ actorId?: string }> };

function rethrow(error: unknown): never {
  if (error instanceof RecoveryError) {
    throw new HttpException({ code: error.code, message: error.message }, error.status);
  }
  throw error;
}

@ApiTags("Owner password recovery")
@Controller("auth/owner/password-recovery")
@UseGuards(OriginGuard)
export class OwnerRecoveryController {
  public constructor(@Inject(RECOVERY_RUNTIME) private readonly runtime: RecoveryRuntime) {}

  @Post("request")
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: "Request password recovery with a non-enumerating response" })
  @ApiAcceptedResponse({ description: "The same response is returned for every request" })
  public async request(@Req() request: ApiRequest) {
    const result = await this.runtime.request(request.id);
    return { data: result, requestId: request.id };
  }

  @Post("start")
  @HttpCode(HttpStatus.OK)
  @ApiBody({ type: StartRecoveryDto })
  @ApiOperation({ summary: "Start one seven-day threshold recovery workflow" })
  @ApiOkResponse({ description: "The password recovery workflow snapshot" })
  public async start(@Body() body: StartRecoveryDto, @Req() request: ApiRequest) {
    try {
      const result = await this.runtime.start({
        ...parseStartRecovery(body),
        requestId: request.id,
      });
      return { data: result, requestId: request.id };
    } catch (error) {
      rethrow(error);
    }
  }

  @Post("material")
  @HttpCode(HttpStatus.OK)
  @ApiBody({ type: CreateRecoveryMaterialDto })
  @ApiOperation({ summary: "Seal recovered vault key to a one-time browser key" })
  @ApiOkResponse({ description: "A 15-minute, browser-bound rewrap session" })
  public async material(@Body() body: CreateRecoveryMaterialDto, @Req() request: ApiRequest) {
    try {
      const result = await this.runtime.material(parseCreateRecoveryMaterial(body));
      return {
        data: {
          resetSessionToken: result.resetSessionToken,
          encryptedVaultKey: encodeBase64Url(result.encryptedVaultKey),
          sealedVaultKeyDigest: encodeBase64Url(result.sealedVaultKeyDigest),
          expiresAt: result.expiresAt,
        },
        requestId: request.id,
      };
    } catch (error) {
      rethrow(error);
    }
  }

  @Post("reset")
  @HttpCode(HttpStatus.OK)
  @ApiBody({ type: CompleteRecoveryDto })
  @ApiOperation({ summary: "Atomically replace owner credentials and wrapped vault key" })
  @ApiOkResponse({ description: "Password recovery completed and prior sessions revoked" })
  public async reset(@Body() body: CompleteRecoveryDto, @Req() request: ApiRequest) {
    try {
      const result = await this.runtime.complete({
        ...parseCompleteRecovery(body),
        requestId: request.id,
      });
      return { data: result, requestId: request.id };
    } catch (error) {
      rethrow(error);
    }
  }
}

@ApiTags("Contact password recovery actions")
@Controller("contact/workflows")
@UseGuards(ContactSessionGuard, OriginGuard, CsrfGuard)
export class ContactRecoveryController {
  public constructor(@Inject(RECOVERY_RUNTIME) private readonly runtime: RecoveryRuntime) {}

  @Post(":workflowId/approve-password-recovery")
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiParam({ name: "workflowId", type: String, format: "uuid" })
  @ApiBody({ type: ApproveRecoveryDto })
  @ApiOperation({ summary: "Approve recovery after contact password reauthentication" })
  @ApiAcceptedResponse({ description: "The sealed recovery share was validated and staged" })
  public async approve(
    @Param("workflowId") workflowId: string,
    @Body() body: ApproveRecoveryDto,
    @Req() request: ApiRequest,
  ) {
    const contactId = request.user?.actorId;
    if (contactId === undefined || contactId.length === 0) {
      throw new UnauthorizedException("authentication is required");
    }
    try {
      const result = await this.runtime.approve({
        workflowId,
        contactId,
        requestId: request.id,
        ...parseApproveRecovery(body),
      });
      return { data: result, requestId: request.id };
    } catch (error) {
      rethrow(error);
    }
  }
}
