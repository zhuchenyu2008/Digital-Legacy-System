import { decodeBase64Url } from "@dls/crypto/node";
import { BadRequestException } from "@nestjs/common";
import { ApiProperty as SwaggerProperty } from "@nestjs/swagger";

export class WorkflowContactDto {
  @SwaggerProperty({ type: String, format: "uuid" })
  contactId!: string;

  @SwaggerProperty({ type: Number, minimum: 1 })
  shareIndex!: number;
}

export class OwnerWorkflowDto {
  @SwaggerProperty({ type: String, format: "uuid" })
  workflowId!: string;

  @SwaggerProperty({ type: String })
  kind!: string;

  @SwaggerProperty({ type: String })
  state!: string;

  @SwaggerProperty({ type: Number, minimum: 1 })
  contactCount!: number;

  @SwaggerProperty({ type: Number, minimum: 1 })
  requiredCount!: number;

  @SwaggerProperty({ type: Number, minimum: 0 })
  approvedCount!: number;

  @SwaggerProperty({ type: () => [WorkflowContactDto] })
  contacts!: WorkflowContactDto[];
}

export class ContactShareDto {
  @SwaggerProperty({ type: String, format: "uuid" })
  generationId!: string;

  @SwaggerProperty({ type: Number, minimum: 1 })
  shareIndex!: number;

  @SwaggerProperty({ type: Number, minimum: 1 })
  protocolVersion!: number;

  @SwaggerProperty({ type: String, format: "byte", writeOnly: true })
  ciphertext!: string;

  @SwaggerProperty({ type: String, format: "byte" })
  commitment!: string;
}

export class ContactIngressDto {
  @SwaggerProperty({ enum: ["DEATH", "RECOVERY"] })
  purpose!: "DEATH" | "RECOVERY";

  @SwaggerProperty({ type: Number, minimum: 1 })
  version!: number;

  @SwaggerProperty({ type: String, format: "byte" })
  publicKey!: string;
}

export class ContactWorkflowDto {
  @SwaggerProperty({ type: String, format: "uuid" })
  workflowId!: string;

  @SwaggerProperty({ type: String })
  kind!: string;

  @SwaggerProperty({ type: String })
  state!: string;

  @SwaggerProperty({ type: String })
  ownerDisplayName!: string;

  @SwaggerProperty({ type: Number, minimum: 0 })
  approvedCount!: number;

  @SwaggerProperty({ type: Number, minimum: 1 })
  requiredCount!: number;

  @SwaggerProperty({ type: Boolean })
  decisionAlreadyMade!: boolean;

  @SwaggerProperty({ type: [String] })
  legalNextActions!: string[];

  @SwaggerProperty({ type: ContactShareDto })
  share!: ContactShareDto;

  @SwaggerProperty({ type: ContactIngressDto })
  ingress!: ContactIngressDto;
}

export class DeathFragmentIngressDto {
  @SwaggerProperty({ type: String, format: "uuid" })
  generationId!: string;

  @SwaggerProperty({ type: Number, minimum: 1 })
  shareIndex!: number;

  @SwaggerProperty({ type: String, format: "byte", writeOnly: true })
  commitmentDigest!: string;

  @SwaggerProperty({ type: Number, minimum: 1 })
  ingressKeyVersion!: number;

  @SwaggerProperty({ type: Number, enum: [1] })
  protocolVersion!: 1;

  @SwaggerProperty({ type: String, format: "byte", writeOnly: true })
  nonce!: string;

  @SwaggerProperty({ type: String, format: "byte", writeOnly: true })
  ciphertext!: string;
}

export class AffirmDeathDto {
  @SwaggerProperty({ type: String, writeOnly: true })
  password!: string;

  @SwaggerProperty({ type: String })
  confirmationText!: string;

  @SwaggerProperty({ type: () => DeathFragmentIngressDto, writeOnly: true })
  fragment!: DeathFragmentIngressDto;
}

export class ConfirmAliveDto {
  @SwaggerProperty({ type: String, writeOnly: true })
  password!: string;

  @SwaggerProperty({ type: String })
  confirmationText!: string;
}

function record(value: unknown, field = "body"): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new BadRequestException(`${field} is required`);
  }
  return value;
}

function integer(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new BadRequestException(`${field} must be a positive integer`);
  }
  return Number(value);
}

function bytes(value: unknown, field: string): Uint8Array {
  try {
    return decodeBase64Url(string(value, field));
  } catch {
    throw new BadRequestException(`${field} must be canonical base64url`);
  }
}

export function parseAffirmDeath(value: unknown) {
  const input = record(value);
  const fragment = record(input.fragment, "fragment");
  if (fragment.protocolVersion !== 1) {
    throw new BadRequestException("fragment.protocolVersion must be 1");
  }
  return {
    password: string(input.password, "password"),
    confirmationText: string(input.confirmationText, "confirmationText"),
    fragment: {
      generationId: string(fragment.generationId, "fragment.generationId"),
      shareIndex: integer(fragment.shareIndex, "fragment.shareIndex"),
      commitmentDigest: bytes(fragment.commitmentDigest, "fragment.commitmentDigest"),
      ingressKeyVersion: integer(fragment.ingressKeyVersion, "fragment.ingressKeyVersion"),
      protocolVersion: 1 as const,
      nonce: bytes(fragment.nonce, "fragment.nonce"),
      ciphertext: bytes(fragment.ciphertext, "fragment.ciphertext"),
    },
  };
}

export function parseConfirmAlive(value: unknown) {
  const input = record(value);
  return {
    password: string(input.password, "password"),
    confirmationText: string(input.confirmationText, "confirmationText"),
  };
}
