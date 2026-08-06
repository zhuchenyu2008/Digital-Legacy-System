import "reflect-metadata";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "../app.module.js";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const outputPath = resolve(workspaceRoot, "packages/contracts/openapi/openapi.json");

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function sortJson(value: JsonValue, key?: string): JsonValue {
  if (Array.isArray(value)) {
    const sorted = value.map((item) => sortJson(item));
    if (key === "tags" || key === "servers") {
      return sorted.sort((left, right) =>
        JSON.stringify(left).localeCompare(JSON.stringify(right)),
      );
    }
    if (key === "parameters") {
      return sorted.sort((left, right) =>
        JSON.stringify(left).localeCompare(JSON.stringify(right)),
      );
    }
    return sorted;
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([entryKey, entryValue]) => [entryKey, sortJson(entryValue, entryKey)]),
  );
}

export function sortOpenApiDocument(document: OpenAPIObject): OpenAPIObject {
  return sortJson(document as unknown as JsonValue) as unknown as OpenAPIObject;
}

export function serializeOpenApiDocument(document: OpenAPIObject): string {
  return `${JSON.stringify(sortOpenApiDocument(document), null, 2)}\n`;
}

export async function buildOpenApiDocument(): Promise<OpenAPIObject> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    logger: false,
  });
  try {
    const options = new DocumentBuilder()
      .setTitle("Digital Legacy System API")
      .setDescription("Local V1 HTTP contract")
      .setVersion("0.1.0")
      .build();
    return sortOpenApiDocument(SwaggerModule.createDocument(app, options));
  } finally {
    await app.close();
  }
}

async function main(): Promise<void> {
  const document = await buildOpenApiDocument();
  const generated = serializeOpenApiDocument(document);
  const mode = process.argv.includes("--check") ? "check" : "write";

  if (mode === "check") {
    const committed = await readFile(outputPath, "utf8");
    if (committed !== generated) {
      throw new Error(`OpenAPI drift detected: ${outputPath}`);
    }
    return;
  }

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, generated, "utf8");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
