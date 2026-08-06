import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import openapiTS, { astToString } from "openapi-typescript";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const openapiPath = resolve(packageRoot, "openapi/openapi.json");
const outputPath = resolve(packageRoot, "src/client/generated.ts");

export async function generateClientSource(document: unknown): Promise<string> {
  const ast = await openapiTS(document as Parameters<typeof openapiTS>[0], {
    alphabetize: true,
    exportType: true,
    immutable: true,
  });
  return `${astToString(ast).trimEnd()}\n`;
}

async function main(): Promise<void> {
  const document = JSON.parse(await readFile(openapiPath, "utf8")) as unknown;
  const generated = await generateClientSource(document);
  const mode = process.argv.includes("--check") ? "check" : "write";

  if (mode === "check") {
    const committed = await readFile(outputPath, "utf8");
    if (committed !== generated) {
      throw new Error(`Generated client drift detected: ${outputPath}`);
    }
    return;
  }

  await writeFile(outputPath, generated, "utf8");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
