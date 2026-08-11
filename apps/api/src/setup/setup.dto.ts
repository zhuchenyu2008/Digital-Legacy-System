import type { OwnerSetupCommand, OwnerVaultEnvelope } from "@dls/application";
import { ApiProperty } from "@nestjs/swagger";

export class OwnerVaultEnvelopeDto {
  @ApiProperty({ type: String, writeOnly: true, format: "byte" })
  public ciphertext!: string;

  @ApiProperty({ type: String, writeOnly: true, format: "byte" })
  public nonce!: string;

  @ApiProperty({ type: String, writeOnly: true, format: "byte" })
  public kdfSalt!: string;

  @ApiProperty({
    writeOnly: true,
    type: Object,
    example: {
      algorithm: "argon2id",
      memoryKiB: 65536,
      iterations: 3,
      parallelism: 1,
      version: 19,
      purpose: "owner-vault-kek-v1",
    },
  })
  public kdfParams!: Record<string, unknown>;

  @ApiProperty({ type: String, writeOnly: true, format: "byte" })
  public keyVerifierCiphertext!: string;

  @ApiProperty({ type: String, writeOnly: true, format: "byte" })
  public keyVerifierNonce!: string;

  @ApiProperty({ type: String, writeOnly: true, pattern: "^[0-9a-f]{64}$" })
  public vkCommitment!: string;

  @ApiProperty({ type: String, writeOnly: true, format: "byte" })
  public ownerEnvelopeProof!: string;

  @ApiProperty({ type: String, writeOnly: true, required: false, format: "byte" })
  public aadHash?: string;
}

export class CreateOwnerDto {
  @ApiProperty({ type: String, writeOnly: true })
  public setupToken!: string;

  @ApiProperty({ type: String, format: "uuid" })
  public vaultId!: string;

  @ApiProperty({ type: String })
  public displayName!: string;

  @ApiProperty({ type: String })
  public primaryEmail!: string;

  @ApiProperty({ type: String, required: false })
  public backupEmail?: string;

  @ApiProperty({ type: String, writeOnly: true, minLength: 12, maxLength: 512 })
  public password!: string;

  @ApiProperty({ type: () => OwnerVaultEnvelopeDto })
  public ownerVaultEnvelope!: OwnerVaultEnvelopeDto;
}

function text(value: unknown, name: string): string {
  if (typeof value !== "string") throw new Error(`${name} is required`);
  return value;
}

export function parseCreateOwner(value: unknown, requestId: string): OwnerSetupCommand {
  if (typeof value !== "object" || value === null)
    throw new Error("request body must be an object");
  const body = value as Record<string, unknown>;
  const rawEnvelope = body.ownerVaultEnvelope;
  if (typeof rawEnvelope !== "object" || rawEnvelope === null)
    throw new Error("ownerVaultEnvelope is required");
  const envelope = rawEnvelope as Record<string, unknown>;
  const params = envelope.kdfParams;
  if (typeof params !== "object" || params === null) throw new Error("kdfParams is required");
  return {
    setupToken: text(body.setupToken, "setupToken"),
    vaultId: text(body.vaultId, "vaultId"),
    displayName: text(body.displayName, "displayName"),
    primaryEmail: text(body.primaryEmail, "primaryEmail"),
    ...(body.backupEmail === undefined
      ? {}
      : { backupEmail: text(body.backupEmail, "backupEmail") }),
    password: text(body.password, "password"),
    ownerVaultEnvelope: {
      ciphertext: text(envelope.ciphertext, "ciphertext"),
      nonce: text(envelope.nonce, "nonce"),
      kdfSalt: text(envelope.kdfSalt, "kdfSalt"),
      kdfParams: params as OwnerVaultEnvelope["kdfParams"],
      keyVerifierCiphertext: text(envelope.keyVerifierCiphertext, "keyVerifierCiphertext"),
      keyVerifierNonce: text(envelope.keyVerifierNonce, "keyVerifierNonce"),
      vkCommitment: text(envelope.vkCommitment, "vkCommitment"),
      ownerEnvelopeProof: text(envelope.ownerEnvelopeProof, "ownerEnvelopeProof"),
      ...(envelope.aadHash === undefined ? {} : { aadHash: text(envelope.aadHash, "aadHash") }),
    },
    requestId,
  };
}
