import { BadRequestException } from "@nestjs/common";
import { ApiProperty } from "@nestjs/swagger";

export class AuditDetailDto {
  @ApiProperty({ type: String, minLength: 1, writeOnly: true })
  password!: string;
}

export function parseAuditDetail(value: unknown): Readonly<{ password: string }> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException("JSON request body must be an object");
  }
  const password = (value as Record<string, unknown>).password;
  if (typeof password !== "string" || password.length === 0) {
    throw new BadRequestException("password is required");
  }
  return { password };
}
