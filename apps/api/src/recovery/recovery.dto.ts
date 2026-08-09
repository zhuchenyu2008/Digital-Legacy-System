import type { OwnerVaultEnvelope, RecoveryFragment } from "@dls/application";
import { decodeBase64Url, isCanonicalBase64Url } from "@dls/crypto/node";
import { BadRequestException } from "@nestjs/common";
import { ApiProperty } from "@nestjs/swagger";

export class StartRecoveryDto {
  @ApiProperty({ type: String, writeOnly: true })
  token!: string;
}

export class ApproveRecoveryDto {
  @ApiProperty({ type: String, writeOnly: true })
  password!: string;

  @ApiProperty({ type: String, format: "uuid" })
  generationId!: string;

  @ApiProperty({ type: Number, minimum: 1 })
  shareIndex!: number;

  @ApiProperty({ type: String, format: "byte", writeOnly: true })
  commitmentDigest!: string;

  @ApiProperty({ type: Number, minimum: 1 })
  ingressKeyVersion!: number;

  @ApiProperty({ type: Number, enum: [1] })
  protocolVersion!: number;

  @ApiProperty({ type: String, format: "byte", writeOnly: true })
  nonce!: string;

  @ApiProperty({ type: String, format: "byte", writeOnly: true })
  ciphertext!: string;
}

export class CreateRecoveryMaterialDto {
  @ApiProperty({ type: String, writeOnly: true })
  token!: string;

  @ApiProperty({ type: String, pattern: "^[0-9]{8}$", writeOnly: true })
  emailVerificationCode!: string;

  @ApiProperty({ type: String, format: "byte", writeOnly: true })
  clientEphemeralPublicKey!: string;
}

export class RecoveryKdfParamsDto {
  @ApiProperty({ enum: ["argon2id"] })
  algorithm!: "argon2id";
  @ApiProperty({ type: Number, enum: [65_536] })
  memoryKiB!: number;
  @ApiProperty({ type: Number, enum: [3] })
  iterations!: number;
  @ApiProperty({ type: Number, enum: [1] })
  parallelism!: number;
  @ApiProperty({ type: Number, enum: [19] })
  version!: number;
  @ApiProperty({ enum: ["owner-vault-kek-v1"] })
  purpose!: "owner-vault-kek-v1";
}

export class RecoveryOwnerVaultEnvelopeDto {
  @ApiProperty({ type: String, format: "byte", writeOnly: true })
  ciphertext!: string;
  @ApiProperty({ type: String, format: "byte", writeOnly: true })
  nonce!: string;
  @ApiProperty({ type: String, format: "byte", writeOnly: true })
  kdfSalt!: string;
  @ApiProperty({ type: RecoveryKdfParamsDto })
  kdfParams!: RecoveryKdfParamsDto;
  @ApiProperty({ type: String, format: "byte", writeOnly: true })
  keyVerifierCiphertext!: string;
  @ApiProperty({ type: String, format: "byte", writeOnly: true })
  keyVerifierNonce!: string;
  @ApiProperty({ type: String, pattern: "^[0-9a-f]{64}$" })
  vkCommitment!: string;
  @ApiProperty({ type: String, format: "byte", writeOnly: true })
  ownerEnvelopeProof!: string;
  @ApiProperty({ type: String, format: "byte", required: false })
  aadHash?: string;
}

export class CompleteRecoveryDto {
  @ApiProperty({ type: String, writeOnly: true })
  resetSessionToken!: string;
  @ApiProperty({ type: String, minLength: 12, maxLength: 512, writeOnly: true })
  newPassword!: string;
  @ApiProperty({ type: RecoveryOwnerVaultEnvelopeDto })
  newOwnerVaultEnvelope!: RecoveryOwnerVaultEnvelopeDto;
  @ApiProperty({ type: String, format: "byte", writeOnly: true })
  vaultKeyProof!: string;
}

function objectBody(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException("JSON request body must be an object");
  }
  return value as Record<string, unknown>;
}

function stringField(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new BadRequestException(`${field} is required`);
  }
  return value;
}

function integerField(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new BadRequestException(`${field} must be a positive integer`);
  }
  return Number(value);
}

function bytesField(value: unknown, field: string, exact?: number, minimum = 1): Uint8Array {
  const encoded = stringField(value, field);
  if (!isCanonicalBase64Url(encoded)) throw new BadRequestException(`${field} is invalid`);
  const decoded = decodeBase64Url(encoded);
  if (decoded.length < minimum || (exact !== undefined && decoded.length !== exact)) {
    decoded.fill(0);
    throw new BadRequestException(`${field} is invalid`);
  }
  return decoded;
}

export function parseStartRecovery(value: unknown) {
  const input = objectBody(value);
  return { token: stringField(input.token, "token") };
}

export function parseApproveRecovery(value: unknown): Readonly<{
  password: string;
  fragment: RecoveryFragment;
}> {
  const input = objectBody(value);
  const protocolVersion = integerField(input.protocolVersion, "protocolVersion");
  if (protocolVersion !== 1) throw new BadRequestException("protocolVersion must be 1");
  return {
    password: stringField(input.password, "password"),
    fragment: {
      generationId: stringField(input.generationId, "generationId"),
      shareIndex: integerField(input.shareIndex, "shareIndex"),
      commitmentDigest: bytesField(input.commitmentDigest, "commitmentDigest", 32),
      ingressKeyVersion: integerField(input.ingressKeyVersion, "ingressKeyVersion"),
      protocolVersion: 1,
      nonce: bytesField(input.nonce, "nonce", 24),
      ciphertext: bytesField(input.ciphertext, "ciphertext", undefined, 49),
    },
  };
}

export function parseCreateRecoveryMaterial(value: unknown) {
  const input = objectBody(value);
  const code = stringField(input.emailVerificationCode, "emailVerificationCode");
  if (!/^\d{8}$/u.test(code)) {
    throw new BadRequestException("emailVerificationCode must be 8 digits");
  }
  return {
    token: stringField(input.token, "token"),
    emailVerificationCode: code,
    clientEphemeralPublicKey: bytesField(
      input.clientEphemeralPublicKey,
      "clientEphemeralPublicKey",
      32,
    ),
  };
}

function parseEnvelope(value: unknown): OwnerVaultEnvelope {
  const input = objectBody(value);
  const kdf = objectBody(input.kdfParams);
  return {
    ciphertext: stringField(input.ciphertext, "newOwnerVaultEnvelope.ciphertext"),
    nonce: stringField(input.nonce, "newOwnerVaultEnvelope.nonce"),
    kdfSalt: stringField(input.kdfSalt, "newOwnerVaultEnvelope.kdfSalt"),
    kdfParams: {
      algorithm: stringField(kdf.algorithm, "kdfParams.algorithm") as "argon2id",
      memoryKiB: integerField(kdf.memoryKiB, "kdfParams.memoryKiB"),
      iterations: integerField(kdf.iterations, "kdfParams.iterations"),
      parallelism: integerField(kdf.parallelism, "kdfParams.parallelism"),
      version: integerField(kdf.version, "kdfParams.version"),
      purpose: stringField(kdf.purpose, "kdfParams.purpose") as "owner-vault-kek-v1",
    },
    keyVerifierCiphertext: stringField(
      input.keyVerifierCiphertext,
      "newOwnerVaultEnvelope.keyVerifierCiphertext",
    ),
    keyVerifierNonce: stringField(input.keyVerifierNonce, "newOwnerVaultEnvelope.keyVerifierNonce"),
    vkCommitment: stringField(input.vkCommitment, "newOwnerVaultEnvelope.vkCommitment"),
    ownerEnvelopeProof: stringField(
      input.ownerEnvelopeProof,
      "newOwnerVaultEnvelope.ownerEnvelopeProof",
    ),
    ...(typeof input.aadHash === "string" ? { aadHash: input.aadHash } : {}),
  };
}

export function parseCompleteRecovery(value: unknown) {
  const input = objectBody(value);
  return {
    resetSessionToken: stringField(input.resetSessionToken, "resetSessionToken"),
    newPassword: stringField(input.newPassword, "newPassword"),
    newOwnerVaultEnvelope: parseEnvelope(input.newOwnerVaultEnvelope),
    vaultKeyProof: stringField(input.vaultKeyProof, "vaultKeyProof"),
  };
}
