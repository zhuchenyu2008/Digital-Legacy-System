import { ContactUseCaseError, type SessionPrincipal } from "@dls/application";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from "@nestjs/swagger";
import type { FastifyReply, FastifyRequest } from "fastify";
import { CsrfGuard } from "../security/csrf.guard.js";
import { OriginGuard } from "../security/origin.guard.js";
import {
  ContactSessionGuard,
  OwnerSessionGuard,
  type SecurityRequest,
} from "../security/session.guard.js";
import { setSessionCookies } from "../security/session-cookies.js";
import {
  AcceptContactInvitationDto,
  CreateContactInvitationDto,
  parseAcceptContactInvitation,
  parseCreateContactInvitation,
  parseRemoveContact,
  parseRequestContactPasswordChange,
  parseResolveContactInvitation,
  RemoveContactDto,
  RequestContactPasswordChangeDto,
  ResolveContactInvitationDto,
} from "./contact.dto.js";
import { CONTACT_RUNTIME, type ContactRuntime } from "./contact.runtime.js";

type OwnerRequest = FastifyRequest & SecurityRequest & { user?: SessionPrincipal };

@ApiTags("Contact invitations")
@Controller()
export class ContactInvitationsController {
  public constructor(@Inject(CONTACT_RUNTIME) private readonly runtime: ContactRuntime) {}

  @Get("owner/contacts")
  @UseGuards(OwnerSessionGuard)
  @ApiOperation({ summary: "List the owner's sanitized emergency contacts" })
  public async list(@Req() request: OwnerRequest) {
    return { data: await this.runtime.list(), requestId: request.id };
  }

  @Post("owner/contacts/invitations")
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(OwnerSessionGuard, OriginGuard, CsrfGuard)
  @ApiBody({ type: CreateContactInvitationDto })
  @ApiOperation({ summary: "Create a one-time emergency contact invitation" })
  @ApiResponse({ status: 202, description: "Invitation queued" })
  public async invite(@Body() body: CreateContactInvitationDto, @Req() request: OwnerRequest) {
    const ownerId = request.user?.actorId;
    if (ownerId === undefined) throw new HttpException("authentication is required", 401);
    try {
      const result = await this.runtime.invite({
        ...parseCreateContactInvitation(body),
        ownerId,
        requestId: request.id,
      });
      return {
        data: {
          contactId: result.contactId,
          invitationId: result.invitationId,
          expiresAt: result.expiresAt,
        },
        requestId: request.id,
      };
    } catch (error) {
      throw this.mapError(error);
    }
  }

  @Post("owner/contacts/:contactId/invitation/resend")
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(OwnerSessionGuard, OriginGuard, CsrfGuard)
  @ApiParam({ name: "contactId", type: String, format: "uuid" })
  @ApiOperation({ summary: "Revoke and resend a contact invitation" })
  public async resend(@Param("contactId") contactId: string, @Req() request: OwnerRequest) {
    const ownerId = request.user?.actorId;
    if (ownerId === undefined) throw new HttpException("authentication is required", 401);
    try {
      const result = await this.runtime.resend({ ownerId, contactId, requestId: request.id });
      return {
        data: {
          contactId: result.contactId,
          invitationId: result.invitationId,
          expiresAt: result.expiresAt,
        },
        requestId: request.id,
      };
    } catch (error) {
      throw this.mapError(error);
    }
  }

  @Post("owner/contacts/:contactId/password-change-invitation")
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(OwnerSessionGuard, OriginGuard, CsrfGuard)
  @ApiParam({ name: "contactId", type: String, format: "uuid" })
  @ApiBody({ type: RequestContactPasswordChangeDto })
  @ApiOperation({ summary: "Issue a one-time contact password-change invitation" })
  public async requestPasswordChange(
    @Param("contactId") contactId: string,
    @Body() body: RequestContactPasswordChangeDto,
    @Req() request: OwnerRequest,
  ) {
    const ownerId = request.user?.actorId;
    if (ownerId === undefined) throw new HttpException("authentication is required", 401);
    try {
      const result = await this.runtime.requestPasswordChange({
        ...parseRequestContactPasswordChange(body),
        ownerId,
        contactId,
        requestId: request.id,
      });
      return {
        data: { contactId: result.contactId, expiresAt: result.expiresAt },
        requestId: request.id,
      };
    } catch (error) {
      throw this.mapError(error);
    }
  }

  @Post("owner/contacts/:contactId/remove")
  @HttpCode(HttpStatus.OK)
  @UseGuards(OwnerSessionGuard, OriginGuard, CsrfGuard)
  @ApiParam({ name: "contactId", type: String, format: "uuid" })
  @ApiBody({ type: RemoveContactDto })
  @ApiOperation({ summary: "Remove an emergency contact and require share regeneration" })
  public async remove(
    @Param("contactId") contactId: string,
    @Body() body: RemoveContactDto,
    @Req() request: OwnerRequest,
  ) {
    const ownerId = request.user?.actorId;
    if (ownerId === undefined) throw new HttpException("authentication is required", 401);
    try {
      const result = await this.runtime.remove({
        ...parseRemoveContact(body),
        ownerId,
        contactId,
        requestId: request.id,
      });
      return { data: result, requestId: request.id };
    } catch (error) {
      throw this.mapError(error);
    }
  }

  @Get("contact/crypto-material")
  @UseGuards(ContactSessionGuard)
  @ApiOperation({ summary: "Read the authenticated contact crypto material" })
  public async cryptoMaterial(@Req() request: OwnerRequest) {
    const contactId = request.user?.actorId;
    if (contactId === undefined) throw new HttpException("authentication is required", 401);
    try {
      return { data: await this.runtime.cryptoMaterial(contactId), requestId: request.id };
    } catch (error) {
      throw this.mapError(error);
    }
  }

  @Post("contact-invitations/resolve")
  @ApiBody({ type: ResolveContactInvitationDto })
  @ApiOperation({ summary: "Resolve an invitation token supplied in the request body" })
  public async resolve(@Body() body: ResolveContactInvitationDto) {
    try {
      return { data: await this.runtime.resolve(parseResolveContactInvitation(body).token) };
    } catch (error) {
      throw this.mapError(error);
    }
  }

  @Post("contact-invitations/accept")
  @ApiBody({ type: AcceptContactInvitationDto })
  @ApiOperation({ summary: "Accept an invitation with consent and a wrapped private key" })
  public async accept(
    @Body() body: AcceptContactInvitationDto,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    try {
      const parsed = parseAcceptContactInvitation(body);
      const result = await this.runtime.accept({
        ...parsed,
        requestId: request.id,
        ...(request.ip === undefined ? {} : { ip: request.ip }),
        ...(request.headers["user-agent"] === undefined
          ? {}
          : { userAgent: request.headers["user-agent"] }),
      });
      setSessionCookies(response, "CONTACT", result.session.token, result.session.csrfToken);
      return {
        data: {
          contactId: result.contactId,
          status: result.status,
          role: "CONTACT",
          session: {
            csrfToken: result.session.csrfToken,
            idleExpiresAt: result.session.principal.idleExpiresAt,
            absoluteExpiresAt: result.session.principal.absoluteExpiresAt,
          },
        },
        requestId: request.id,
      };
    } catch (error) {
      throw this.mapError(error);
    }
  }

  private mapError(error: unknown): HttpException {
    if (error instanceof ContactUseCaseError) {
      return new HttpException({ code: error.code, message: error.message }, error.status);
    }
    return error instanceof HttpException ? error : new HttpException("Request failed", 500);
  }
}
