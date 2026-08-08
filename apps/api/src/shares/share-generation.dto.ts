import { BadRequestException } from "@nestjs/common";
import {
  ApiProperty as SwaggerProperty,
  ApiPropertyOptional as SwaggerPropertyOptional,
} from "@nestjs/swagger";

export class CreateShareGenerationDto {
  @SwaggerProperty({ type: String, format: "uuid" })
  vaultId!: string;

  @SwaggerProperty({ type: Number, minimum: 0 })
  contactSetVersion!: number;

  @SwaggerPropertyOptional({ type: String, format: "uuid" })
  expectedCurrentGenerationId?: string;
}

export class ShareGenerationShareDto {
  @SwaggerProperty({ type: String, format: "uuid" })
  contactId!: string;

  @SwaggerProperty({ type: Number, minimum: 1 })
  shareIndex!: number;

  @SwaggerProperty({ type: String, format: "byte", writeOnly: true })
  deathShareCiphertext!: string;

  @SwaggerProperty({ type: String, format: "byte", writeOnly: true })
  recoveryShareCiphertext!: string;

  @SwaggerProperty({ type: String, format: "byte" })
  deathShareCommitment!: string;

  @SwaggerProperty({ type: String, format: "byte" })
  recoveryShareCommitment!: string;
}

export class UploadShareGenerationDto {
  @SwaggerProperty({ type: Number, minimum: 0 })
  contactSetVersion!: number;

  @SwaggerProperty({ type: String, pattern: "^[0-9a-f]{64}$" })
  contactsSnapshotSha256!: string;

  @SwaggerProperty({ type: Number, minimum: 1 })
  protocolVersion!: number;

  @SwaggerProperty({ type: String })
  vssScheme!: string;

  @SwaggerProperty({ type: String, format: "byte", writeOnly: true })
  generationCommitment!: string;

  @SwaggerProperty({ type: String, pattern: "^[0-9a-f]{64}$" })
  vkCommitment!: string;

  @SwaggerProperty({ type: String, format: "byte", writeOnly: true })
  generationProof!: string;

  @SwaggerProperty({ type: () => [ShareGenerationShareDto], writeOnly: true })
  shares!: ShareGenerationShareDto[];
}

export class ActivateShareGenerationDto {
  @SwaggerProperty({ type: Number, minimum: 0 })
  contactSetVersion!: number;

  @SwaggerPropertyOptional({ type: String, format: "uuid" })
  expectedCurrentGenerationId?: string;
}

function objectBody(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException("JSON request body must be an object");
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0)
    throw new BadRequestException(`${field} is required`);
  return value;
}

function requiredInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new BadRequestException(`${field} must be a non-negative safe integer`);
  }
  return value;
}

function decodeBase64Url(value: unknown, field: string): Uint8Array {
  const text = requiredString(value, field);
  if (!/^[A-Za-z0-9_-]+$/u.test(text) || text.length % 4 === 1) {
    throw new BadRequestException(`${field} must be canonical base64url`);
  }
  return new Uint8Array(Buffer.from(text, "base64url"));
}

function decodeHex(value: unknown, field: string, bytes: number): Uint8Array {
  const text = requiredString(value, field);
  if (!new RegExp(`^[0-9a-f]{${bytes * 2}}$`, "u").test(text)) {
    throw new BadRequestException(`${field} must be lowercase hexadecimal`);
  }
  return new Uint8Array(Buffer.from(text, "hex"));
}

export function parseCreateShareGeneration(value: unknown) {
  const input = objectBody(value);
  return {
    vaultId: requiredString(input.vaultId, "vaultId"),
    contactSetVersion: requiredInteger(input.contactSetVersion, "contactSetVersion"),
    ...(input.expectedCurrentGenerationId === undefined
      ? {}
      : {
          expectedCurrentGenerationId: requiredString(
            input.expectedCurrentGenerationId,
            "expectedCurrentGenerationId",
          ),
        }),
  };
}

export function parseUploadShareGeneration(value: unknown) {
  const input = objectBody(value);
  const shares = input.shares;
  if (!Array.isArray(shares) || shares.length === 0)
    throw new BadRequestException("shares are required");
  return {
    contactSetVersion: requiredInteger(input.contactSetVersion, "contactSetVersion"),
    contactsSnapshotSha256: decodeHex(input.contactsSnapshotSha256, "contactsSnapshotSha256", 32),
    protocolVersion: requiredInteger(input.protocolVersion, "protocolVersion"),
    vssScheme: requiredString(input.vssScheme, "vssScheme"),
    generationCommitment: decodeBase64Url(input.generationCommitment, "generationCommitment"),
    vkCommitment: decodeHex(input.vkCommitment, "vkCommitment", 32),
    generationProof: decodeBase64Url(input.generationProof, "generationProof"),
    shares: shares.map((item, index) => {
      const share = objectBody(item);
      return {
        contactId: requiredString(share.contactId, `shares[${index}].contactId`),
        shareIndex: requiredInteger(share.shareIndex, `shares[${index}].shareIndex`),
        deathShareCiphertext: decodeBase64Url(
          share.deathShareCiphertext,
          `shares[${index}].deathShareCiphertext`,
        ),
        recoveryShareCiphertext: decodeBase64Url(
          share.recoveryShareCiphertext,
          `shares[${index}].recoveryShareCiphertext`,
        ),
        deathShareCommitment: decodeBase64Url(
          share.deathShareCommitment,
          `shares[${index}].deathShareCommitment`,
        ),
        recoveryShareCommitment: decodeBase64Url(
          share.recoveryShareCommitment,
          `shares[${index}].recoveryShareCommitment`,
        ),
      };
    }),
  };
}

export function parseActivateShareGeneration(value: unknown) {
  const input = objectBody(value);
  return {
    contactSetVersion: requiredInteger(input.contactSetVersion, "contactSetVersion"),
    ...(input.expectedCurrentGenerationId === undefined
      ? {}
      : {
          expectedCurrentGenerationId: requiredString(
            input.expectedCurrentGenerationId,
            "expectedCurrentGenerationId",
          ),
        }),
  };
}
