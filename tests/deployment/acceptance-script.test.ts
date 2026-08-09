import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

describe("root acceptance workflow", () => {
  test("builds workspace packages before starting browser tests", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(workspaceRoot, "package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };
    const acceptance = packageJson.scripts?.acceptance ?? "";

    expect(acceptance).toContain("corepack pnpm run build");
    expect(acceptance).toContain("corepack pnpm run test:e2e");
    expect(acceptance.indexOf("corepack pnpm run build")).toBeLessThan(
      acceptance.indexOf("corepack pnpm run test:e2e"),
    );
  });
});
