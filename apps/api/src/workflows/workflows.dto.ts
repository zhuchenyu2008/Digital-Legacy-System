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
