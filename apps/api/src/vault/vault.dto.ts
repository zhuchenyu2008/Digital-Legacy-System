import type { EncryptedPackageMetadata } from "@dls/application";
import { BadRequestException } from "@nestjs/common";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class CreateVaultUploadDto {
  @ApiPropertyOptional({ type: String, format: "uuid" })
  packageId?: string;

  @ApiPropertyOptional({ type: Number, minimum: 1 })
  packageVersion?: number;

  @ApiProperty({ type: String, format: "uuid" })
  vaultId!: string;

  @ApiProperty({ type: String, format: "uuid" })
  shareGenerationId!: string;

  @ApiProperty({ type: String, example: "XCHACHA20_POLY1305_SECRETSTREAM_V1" })
  cipherAlgorithm!: string;

  @ApiProperty({ type: String, description: "Base64url encoded secretstream header" })
  streamHeader!: string;

  @ApiProperty({ type: Number, format: "int64", minimum: 0 })
  encryptedSize!: number;

  @ApiProperty({ type: String, pattern: "^[0-9a-f]{64}$" })
  ciphertextSha256!: string;

  @ApiProperty({ type: String, description: "Base64url encoded DEK envelope" })
  dekEnvelope!: string;

  @ApiProperty({ type: String, description: "Base64url encoded DEK envelope nonce" })
  dekEnvelopeNonce!: string;

  @ApiProperty({ type: String })
  dekEnvelopeAlgorithm!: string;

  @ApiProperty({ type: Number, minimum: 1 })
  dekEnvelopeProtocolVersion!: number;

  @ApiProperty({ type: String, description: "Base64url encoded DEK envelope AAD hash" })
  dekEnvelopeAadHash!: string;

  @ApiProperty({ type: String, description: "Base64url encoded authenticated manifest" })
  manifestCiphertext!: string;

  @ApiProperty({ type: String, description: "Base64url encoded manifest nonce" })
  manifestNonce!: string;

  @ApiProperty({ type: String })
  manifestAlgorithm!: string;

  @ApiProperty({ type: String, description: "Base64url encoded manifest AAD hash" })
  manifestAadHash!: string;

  @ApiProperty({ type: String })
  clientCryptoVersion!: string;
}

export class CompleteVaultUploadDto {
  @ApiProperty({ type: String, format: "uuid" })
  uploadId!: string;

  @ApiProperty({ type: Number, format: "int64", minimum: 0 })
  ciphertextSize!: number;

  @ApiProperty({ type: String, pattern: "^[0-9a-f]{64}$" })
  ciphertextSha256!: string;

  @ApiPropertyOptional({ type: () => [VaultUploadPartDto] })
  parts?: VaultUploadPartDto[];
}

export class VaultUploadPartDto {
  @ApiProperty({ type: Number, minimum: 1 })
  partNumber!: number;

  @ApiProperty({ type: String })
  etag!: string;
}

export class ActivateVaultPackageDto {
  @ApiProperty({ type: String, minLength: 1, writeOnly: true })
  password!: string;

  @ApiPropertyOptional({ type: String, format: "uuid" })
  expectedCurrentPackageId?: string;

  @ApiPropertyOptional({ type: String, format: "uuid" })
  expectedShareGenerationId?: string;
}

export type VaultMutationHeaders = Readonly<{
  csrfToken: string;
  idempotencyKey: string;
}>;

function objectBody(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException("JSON request body must be an object");
  }
  return value as Record<string, unknown>;
}

function requiredString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== "string" || value.length === 0)
    throw new BadRequestException(`${field} is required`);
  return value;
}

function requiredInteger(body: Record<string, unknown>, field: string): number {
  const value = body[field];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new BadRequestException(`${field} must be a non-negative safe integer`);
  }
  return value;
}

export function decodeBase64Url(value: unknown, field: string): Uint8Array {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    !/^[A-Za-z0-9_-]+$/u.test(value) ||
    value.length % 4 === 1
  ) {
    throw new BadRequestException(`${field} must be non-empty base64url`);
  }
  const padded = value
    .replace(/-/gu, "+")
    .replace(/_/gu, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  return new Uint8Array(Buffer.from(padded, "base64"));
}

export function parseCreateVaultUpload(
  body: unknown,
  expiresAt: string,
): EncryptedPackageMetadata & { expiresAt: string } {
  const input = objectBody(body);
  const packageVersion =
    input.packageVersion === undefined ? undefined : requiredInteger(input, "packageVersion");
  if (packageVersion !== undefined && packageVersion < 1) {
    throw new BadRequestException("packageVersion must be a positive safe integer");
  }
  return {
    ...(input.packageId === undefined ? {} : { packageId: requiredString(input, "packageId") }),
    ...(packageVersion === undefined ? {} : { packageVersion }),
    vaultId: requiredString(input, "vaultId"),
    shareGenerationId: requiredString(input, "shareGenerationId"),
    cipherAlgorithm: requiredString(input, "cipherAlgorithm"),
    streamHeader: decodeBase64Url(input.streamHeader, "streamHeader"),
    ciphertextSize: requiredInteger(input, "encryptedSize"),
    ciphertextSha256: requiredString(input, "ciphertextSha256"),
    dekEnvelope: decodeBase64Url(input.dekEnvelope, "dekEnvelope"),
    dekEnvelopeNonce: decodeBase64Url(input.dekEnvelopeNonce, "dekEnvelopeNonce"),
    dekEnvelopeAlgorithm: requiredString(input, "dekEnvelopeAlgorithm"),
    dekEnvelopeProtocolVersion: requiredInteger(input, "dekEnvelopeProtocolVersion"),
    dekEnvelopeAadHash: decodeBase64Url(input.dekEnvelopeAadHash, "dekEnvelopeAadHash"),
    manifestCiphertext: decodeBase64Url(input.manifestCiphertext, "manifestCiphertext"),
    manifestNonce: decodeBase64Url(input.manifestNonce, "manifestNonce"),
    manifestAlgorithm: requiredString(input, "manifestAlgorithm"),
    manifestAadHash: decodeBase64Url(input.manifestAadHash, "manifestAadHash"),
    clientCryptoVersion: requiredString(input, "clientCryptoVersion"),
    expiresAt,
  };
}

export function parseCompleteVaultUpload(body: unknown) {
  const input = objectBody(body);
  const parts = input.parts;
  if (
    parts !== undefined &&
    (!Array.isArray(parts) || parts.some((part) => part === null || typeof part !== "object"))
  ) {
    throw new BadRequestException("parts must be an array of objects");
  }
  return {
    uploadId: requiredString(input, "uploadId"),
    ciphertextSize: requiredInteger(input, "ciphertextSize"),
    ciphertextSha256: requiredString(input, "ciphertextSha256"),
    parts: parts?.map((part) => {
      const value = part as Record<string, unknown>;
      return {
        partNumber: requiredInteger(value, "partNumber"),
        etag: requiredString(value, "etag"),
      };
    }),
  };
}

export function parseActivateVaultPackage(body: unknown) {
  const input = objectBody(body);
  return {
    password: requiredString(input, "password"),
    ...(input.expectedCurrentPackageId === undefined
      ? {}
      : { expectedCurrentPackageId: requiredString(input, "expectedCurrentPackageId") }),
    ...(input.expectedShareGenerationId === undefined
      ? {}
      : { expectedShareGenerationId: requiredString(input, "expectedShareGenerationId") }),
  };
}

export function readHeader(value: string | string[] | undefined, field: string): string {
  if (typeof value !== "string" || value.length === 0)
    throw new BadRequestException(`${field} header is required`);
  return value;
}

export function requireMutationHeaders(
  headers: Record<string, string | string[] | undefined>,
): VaultMutationHeaders {
  return {
    csrfToken: readHeader(headers["x-csrf-token"], "x-csrf-token"),
    idempotencyKey: readHeader(headers["idempotency-key"], "idempotency-key"),
  };
}

export function readContentLength(value: string | string[] | undefined): number {
  const raw = readHeader(value, "content-length");
  if (!/^\d+$/u.test(raw)) throw new BadRequestException("content-length must be an integer");
  const length = Number(raw);
  if (!Number.isSafeInteger(length))
    throw new BadRequestException("content-length exceeds safe integer range");
  return length;
}
