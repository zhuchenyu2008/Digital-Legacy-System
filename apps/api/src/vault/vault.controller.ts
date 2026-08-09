import { type VaultPackageRecord, VaultUseCaseError } from "@dls/application";
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  Inject,
  Param,
  Post,
  Put,
  Req,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import type { FastifyRequest } from "fastify";
import { CsrfGuard } from "../security/csrf.guard.js";
import { OriginGuard } from "../security/origin.guard.js";
import { OwnerSessionGuard, type SecurityRequest } from "../security/session.guard.js";
import {
  ActivateVaultPackageDto,
  CompleteVaultUploadDto,
  CreateVaultUploadDto,
  parseActivateVaultPackage,
  parseCompleteVaultUpload,
  parseCreateVaultUpload,
  readContentLength,
  readHeader,
  requireMutationHeaders,
} from "./vault.dto.js";
import { VAULT_RUNTIME, type VaultRequestContext, type VaultRuntime } from "./vault.runtime.js";

type AuthenticatedRequest = FastifyRequest &
  SecurityRequest & {
    user?: Readonly<{ actorId?: string }>;
  };

function publicPackage(record: VaultPackageRecord) {
  return {
    id: record.id,
    vaultId: record.vaultId,
    versionNo: record.versionNo,
    status: record.status,
    ciphertextSize: record.ciphertextSize,
    ciphertextSha256: record.ciphertextSha256,
    expiresAt: record.expiresAt,
    uploadedAt: record.uploadedAt,
    readyAt: record.readyAt,
    activatedAt: record.activatedAt,
    supersededAt: record.supersededAt,
  };
}

@ApiTags("Vault")
@ApiBearerAuth()
@Controller("owner")
@UseGuards(OwnerSessionGuard)
export class VaultController {
  public constructor(@Inject(VAULT_RUNTIME) private readonly runtime: VaultRuntime) {}

  @Post("packages/uploads")
  @UseGuards(OriginGuard, CsrfGuard)
  @ApiOperation({ summary: "Create an encrypted vault package upload session" })
  @ApiBody({ type: CreateVaultUploadDto })
  @ApiHeader({ name: "x-csrf-token", required: true })
  @ApiHeader({ name: "idempotency-key", required: true })
  @ApiResponse({ status: 201, description: "Upload session created" })
  public async createUploadSession(
    @Body() body: CreateVaultUploadDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const context = this.context(request, true);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    return this.run(async () => {
      const session = await this.runtime.createUploadSession(
        parseCreateVaultUpload(body, expiresAt),
        context,
      );
      return {
        package: publicPackage(session.package),
        upload: session.upload,
      };
    });
  }

  @Put("packages/:packageId/content")
  @UseGuards(OriginGuard, CsrfGuard)
  @ApiOperation({ summary: "Stream encrypted ciphertext into staging storage" })
  @ApiParam({ name: "packageId", type: String, format: "uuid" })
  @ApiHeader({ name: "x-csrf-token", required: true })
  @ApiHeader({ name: "idempotency-key", required: true })
  @ApiHeader({ name: "x-upload-id", required: true })
  @ApiHeader({ name: "content-length", required: true })
  @ApiHeader({ name: "content-type", required: true, example: "application/octet-stream" })
  @ApiResponse({ status: 200, description: "Ciphertext staged" })
  public async streamContent(
    @Param("packageId") packageId: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Req() request: AuthenticatedRequest,
  ) {
    const context = this.context(request, true, headers);
    const contentType = readHeader(headers["content-type"], "content-type");
    if ((contentType.split(";", 1)[0] ?? "").trim().toLowerCase() !== "application/octet-stream") {
      throw new BadRequestException("content-type must be application/octet-stream");
    }
    const result = await this.run(() =>
      this.runtime.streamUpload(
        {
          packageId,
          uploadId: readHeader(headers["x-upload-id"], "x-upload-id"),
          contentLength: readContentLength(headers["content-length"]),
          body: request.raw as unknown as AsyncIterable<Uint8Array>,
        },
        context,
      ),
    );
    return { status: result.status, bytes: result.storageMetadata?.bytes ?? result.ciphertextSize };
  }

  @Post("packages/:packageId/complete")
  @UseGuards(OriginGuard, CsrfGuard)
  @ApiOperation({ summary: "Verify the staged ciphertext and mark the package READY" })
  @ApiParam({ name: "packageId", type: String, format: "uuid" })
  @ApiBody({ type: CompleteVaultUploadDto })
  @ApiHeader({ name: "x-csrf-token", required: true })
  @ApiHeader({ name: "idempotency-key", required: true })
  @ApiResponse({ status: 200, description: "Package is READY" })
  public async complete(
    @Param("packageId") packageId: string,
    @Body() body: CompleteVaultUploadDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const context = this.context(request, true);
    const parsed = parseCompleteVaultUpload(body);
    return this.run(async () =>
      publicPackage(
        await this.runtime.completeUpload(
          {
            packageId,
            uploadId: parsed.uploadId,
            ciphertextSize: parsed.ciphertextSize,
            ciphertextSha256: parsed.ciphertextSha256,
            ...(parsed.parts === undefined ? {} : { parts: parsed.parts }),
          },
          context,
        ),
      ),
    );
  }

  @Post("packages/:packageId/activate")
  @UseGuards(OriginGuard, CsrfGuard)
  @ApiOperation({ summary: "Atomically activate a verified encrypted package" })
  @ApiParam({ name: "packageId", type: String, format: "uuid" })
  @ApiBody({ type: ActivateVaultPackageDto })
  @ApiHeader({ name: "x-csrf-token", required: true })
  @ApiHeader({ name: "idempotency-key", required: true })
  @ApiResponse({ status: 200, description: "Package is ACTIVE" })
  public async activate(
    @Param("packageId") packageId: string,
    @Body() body: ActivateVaultPackageDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const context = this.context(request, true);
    return this.run(async () =>
      publicPackage(
        await this.runtime.activatePackage(
          { packageId, ...parseActivateVaultPackage(body), actorId: context.ownerId },
          context,
        ),
      ),
    );
  }

  @Get("packages")
  @ApiOperation({ summary: "List encrypted vault package versions" })
  @ApiResponse({ status: 200, description: "Package versions" })
  public async list(@Req() request: AuthenticatedRequest) {
    const context = this.context(request, false);
    return this.run(async () => (await this.runtime.listPackages(context)).map(publicPackage));
  }

  @Post("packages/:packageId/abort")
  @UseGuards(OriginGuard, CsrfGuard)
  @ApiOperation({ summary: "Abort an upload and remove its staging object" })
  @ApiParam({ name: "packageId", type: String, format: "uuid" })
  @ApiHeader({ name: "x-csrf-token", required: true })
  @ApiHeader({ name: "idempotency-key", required: true })
  @ApiHeader({ name: "x-upload-id", required: true })
  @ApiResponse({ status: 200, description: "Upload aborted" })
  public async abort(
    @Param("packageId") packageId: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Req() request: AuthenticatedRequest,
  ) {
    const context = this.context(request, true, headers);
    return this.run(async () =>
      publicPackage(
        await this.runtime.abortUpload(
          { packageId, uploadId: readHeader(headers["x-upload-id"], "x-upload-id") },
          context,
        ),
      ),
    );
  }

  private context(
    request: AuthenticatedRequest,
    mutation: boolean,
    headers = request.headers,
  ): VaultRequestContext {
    const ownerId = request.user?.actorId;
    if (ownerId === undefined || ownerId.length === 0)
      throw new UnauthorizedException("owner authentication is required");
    const mutationHeaders = mutation
      ? requireMutationHeaders(headers)
      : { csrfToken: "", idempotencyKey: "" };
    return { ownerId, ...mutationHeaders, requestId: request.id };
  }

  private async run<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof VaultUseCaseError)
        throw new HttpException({ code: error.code, message: error.message }, error.status);
      if (error instanceof HttpException) throw error;
      throw error;
    }
  }
}
