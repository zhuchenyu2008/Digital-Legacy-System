import type { TemplateOverride } from "@dls/email-templates";
import { BadRequestException } from "@nestjs/common";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class TemplateOverrideDto implements TemplateOverride {
  @ApiProperty({ type: Number, minimum: 1 })
  version!: number;

  @ApiProperty({ type: String })
  subjectTemplate!: string;

  @ApiProperty({ type: String })
  bodyTemplate!: string;

  @ApiProperty({ type: String })
  textTemplate!: string;
}

export class EmailTemplatePreviewDto {
  @ApiProperty({ enum: ["synthetic", "data"] })
  mode!: "synthetic" | "data";

  @ApiPropertyOptional({ type: Object, additionalProperties: { type: "string" } })
  data?: Record<string, string>;

  @ApiPropertyOptional({ type: () => TemplateOverrideDto })
  override?: TemplateOverrideDto;
}

export type EmailTemplatePreviewInput = Readonly<
  | { mode: "synthetic"; override?: TemplateOverride }
  | { mode: "data"; data: Readonly<Record<string, unknown>>; override?: TemplateOverride }
>;

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function parseOverride(value: unknown): TemplateOverride | undefined {
  if (value === undefined) return undefined;
  const input = objectValue(value, "override");
  const allowed = ["version", "subjectTemplate", "bodyTemplate", "textTemplate"];
  const unknown = Object.keys(input).filter((field) => !allowed.includes(field));
  if (unknown.length > 0)
    throw new BadRequestException(`unknown override fields: ${unknown.join(", ")}`);
  if (!Number.isSafeInteger(input.version) || Number(input.version) < 1) {
    throw new BadRequestException("override.version must be a positive integer");
  }
  for (const field of ["subjectTemplate", "bodyTemplate", "textTemplate"] as const) {
    if (typeof input[field] !== "string" || input[field].length === 0) {
      throw new BadRequestException(`override.${field} must be a non-empty string`);
    }
  }
  return {
    version: Number(input.version),
    subjectTemplate: String(input.subjectTemplate),
    bodyTemplate: String(input.bodyTemplate),
    textTemplate: String(input.textTemplate),
  };
}

export function parseEmailTemplatePreview(value: unknown): EmailTemplatePreviewInput {
  const input = objectValue(value, "preview body");
  const allowed = ["mode", "data", "override"];
  const unknown = Object.keys(input).filter((field) => !allowed.includes(field));
  if (unknown.length > 0)
    throw new BadRequestException(`unknown preview fields: ${unknown.join(", ")}`);
  const override = parseOverride(input.override);
  if (input.mode === "synthetic") {
    if (input.data !== undefined)
      throw new BadRequestException("synthetic preview does not accept data");
    return { mode: "synthetic", ...(override === undefined ? {} : { override }) };
  }
  if (input.mode === "data") {
    const data = objectValue(input.data, "data");
    return { mode: "data", data, ...(override === undefined ? {} : { override }) };
  }
  throw new BadRequestException("mode must be synthetic or data");
}
