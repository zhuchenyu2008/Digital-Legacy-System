import type { ContactConsentInput, ContactPrivateKeyEnvelope } from "@dls/application";
import { BadRequestException } from "@nestjs/common";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class CreateContactInvitationDto {
  @ApiProperty({ type: String, minLength: 1, maxLength: 120 })
  displayName!: string;

  @ApiProperty({ type: String, format: "email" })
  email!: string;
}

export class ResolveContactInvitationDto {
  @ApiProperty({ type: String, minLength: 40, writeOnly: true })
  token!: string;
}

export class ContactLoginDto {
  @ApiProperty({ type: String, minLength: 1 })
  displayName!: string;

  @ApiProperty({ type: String, minLength: 12, maxLength: 512, writeOnly: true })
  password!: string;

  @ApiPropertyOptional({ type: String, writeOnly: true })
  entryToken?: string;
}

export class ContactPrivateKeyEnvelopeDto {
  @ApiProperty({ type: String, format: "byte", writeOnly: true })
  publicKey!: string;

  @ApiProperty({ type: String, format: "byte", writeOnly: true })
  ciphertext!: string;

  @ApiProperty({ type: String, format: "byte", writeOnly: true })
  nonce!: string;

  @ApiProperty({ type: String, format: "byte", writeOnly: true })
  kdfSalt!: string;

  @ApiProperty({ type: Object, writeOnly: true })
  kdfParams!: Record<string, unknown>;

  @ApiProperty({ type: String, format: "byte", writeOnly: true })
  privateKeyProof!: string;
}

export class ContactConsentDto {
  @ApiProperty({ type: String })
  version!: string;

  @ApiProperty({ type: String, pattern: "^[0-9a-f]{64}$" })
  documentSha256!: string;

  @ApiProperty({ type: Boolean })
  termsAccepted!: boolean;

  @ApiProperty({ type: Boolean })
  privacyAccepted!: boolean;

  @ApiProperty({ type: Boolean })
  denialDisclosureAccepted!: boolean;

  @ApiProperty({ type: Boolean })
  stage2LockAccepted!: boolean;
}

export class AcceptContactInvitationDto {
  @ApiProperty({ type: String, minLength: 40, writeOnly: true })
  token!: string;

  @ApiProperty({ type: String, minLength: 12, maxLength: 512, writeOnly: true })
  password!: string;

  @ApiProperty({ type: () => ContactPrivateKeyEnvelopeDto, writeOnly: true })
  privateKeyEnvelope!: ContactPrivateKeyEnvelopeDto;

  @ApiProperty({ type: () => ContactConsentDto })
  consent!: ContactConsentDto;
}

function objectBody(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException("JSON request body must be an object");
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new BadRequestException(`${field} is required`);
  }
  return value;
}

function nestedObject(value: unknown, field: string): Record<string, unknown> {
  const result = objectBody(value);
  if (Object.keys(result).length === 0) throw new BadRequestException(`${field} is required`);
  return result;
}

export function parseCreateContactInvitation(value: unknown) {
  const input = objectBody(value);
  return {
    displayName: requiredString(input.displayName, "displayName"),
    email: requiredString(input.email, "email"),
  };
}

export function parseResolveContactInvitation(value: unknown) {
  const input = objectBody(value);
  return { token: requiredString(input.token, "token") };
}

export function parseContactLogin(value: unknown) {
  const input = objectBody(value);
  return {
    displayName: requiredString(input.displayName, "displayName"),
    password: requiredString(input.password, "password"),
  };
}

export function parseAcceptContactInvitation(value: unknown) {
  const input = objectBody(value);
  const privateKeyEnvelope = nestedObject(input.privateKeyEnvelope, "privateKeyEnvelope");
  const consent = nestedObject(input.consent, "consent");
  return {
    token: requiredString(input.token, "token"),
    password: requiredString(input.password, "password"),
    privateKeyEnvelope: privateKeyEnvelope as unknown as ContactPrivateKeyEnvelope,
    consent: consent as unknown as ContactConsentInput,
  };
}
