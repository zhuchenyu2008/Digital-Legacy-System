import type { OwnerVaultEnvelope } from "@dls/application";
import { BadRequestException } from "@nestjs/common";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { OwnerVaultEnvelopeDto } from "../setup/setup.dto.js";

export class OwnerLoginDto {
  @ApiProperty({ type: String, minLength: 1, writeOnly: true })
  password!: string;
}

export class OwnerCheckInDto {
  @ApiProperty({ type: String, minLength: 1, writeOnly: true })
  password!: string;
}

export class UpdateOwnerSettingsDto {
  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: 365 })
  missedDaysThreshold?: number;

  @ApiProperty({ type: String, minLength: 1, writeOnly: true })
  password!: string;
}

export class ChangeOwnerPasswordDto {
  @ApiProperty({ type: String, minLength: 1, writeOnly: true })
  oldPassword!: string;

  @ApiProperty({ type: String, minLength: 12, maxLength: 512, writeOnly: true })
  newPassword!: string;

  @ApiProperty({ type: () => OwnerVaultEnvelopeDto, writeOnly: true })
  newOwnerVaultEnvelope!: OwnerVaultEnvelopeDto;

  @ApiPropertyOptional({ type: String, writeOnly: true })
  vaultKeyProof?: string;
}

function bodyObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException("JSON request body must be an object");
  }
  return value as Record<string, unknown>;
}

function password(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new BadRequestException("password is required");
  }
  return value;
}

export function parseOwnerLogin(value: unknown) {
  const input = bodyObject(value);
  return { password: password(input.password) };
}

export function parseOwnerCheckIn(value: unknown) {
  const input = bodyObject(value);
  return { password: password(input.password) };
}

export function parseOwnerSettings(value: unknown) {
  const input = bodyObject(value);
  const missedDaysThreshold = input.missedDaysThreshold;
  if (
    missedDaysThreshold !== undefined &&
    (typeof missedDaysThreshold !== "number" || !Number.isSafeInteger(missedDaysThreshold))
  ) {
    throw new BadRequestException("missedDaysThreshold must be an integer");
  }
  return {
    password: password(input.password),
    ...(missedDaysThreshold === undefined ? {} : { missedDaysThreshold }),
  };
}

export function parseOwnerPasswordChange(value: unknown) {
  const input = bodyObject(value);
  const envelope = input.newOwnerVaultEnvelope;
  if (envelope === null || typeof envelope !== "object" || Array.isArray(envelope)) {
    throw new BadRequestException("newOwnerVaultEnvelope is required");
  }
  return {
    oldPassword: password(input.oldPassword),
    newPassword: password(input.newPassword),
    newOwnerVaultEnvelope: envelope as OwnerVaultEnvelope,
    ...(typeof input.vaultKeyProof === "string" ? { vaultKeyProof: input.vaultKeyProof } : {}),
  };
}
