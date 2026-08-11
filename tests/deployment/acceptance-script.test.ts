import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

describe("root acceptance workflow", () => {
  test("dispatches the single root gate to the complete platform acceptance script", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(workspaceRoot, "package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };
    const acceptance = packageJson.scripts?.acceptance ?? "";

    expect(acceptance).toBe("node ops/scripts/run-acceptance.mjs");

    const description = JSON.parse(
      execFileSync(process.execPath, ["ops/scripts/run-acceptance.mjs", "--describe"], {
        cwd: workspaceRoot,
        encoding: "utf8",
      }),
    ) as { command?: readonly string[] };
    expect(description.command).toContain(
      process.platform === "win32" ? "ops/scripts/acceptance.ps1" : "ops/scripts/acceptance.sh",
    );
  });
});
