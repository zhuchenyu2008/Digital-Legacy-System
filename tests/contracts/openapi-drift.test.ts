import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  buildOpenApiDocument,
  serializeOpenApiDocument,
} from "../../apps/api/src/openapi/generate-openapi.js";
import { generateClientSource } from "../../packages/contracts/scripts/generate-client.js";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

describe("generated OpenAPI contract", () => {
  test("matches the deterministic document and generated client committed to the repository", async () => {
    const document = await buildOpenApiDocument();
    const openapi = await readFile(
      resolve(workspaceRoot, "packages/contracts/openapi/openapi.json"),
      "utf8",
    );
    const client = await readFile(
      resolve(workspaceRoot, "packages/contracts/src/client/generated.ts"),
      "utf8",
    );

    expect(serializeOpenApiDocument(document)).toBe(openapi);
    expect(await generateClientSource(document)).toBe(client);
  });
});
