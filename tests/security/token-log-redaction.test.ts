import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { redactSecrets, scanText } from "./secret-scan.js";

const run = promisify(execFile);
const root = resolve(import.meta.dirname, "../..");

describe("token and log redaction", () => {
  it("detects raw credentials and redacts them before persistence", () => {
    const raw = "request token=token-secret-123456 password=owner-password-2026";
    expect(() => scanText(raw, { source: "log", approved: [] })).toThrow(/secret/i);
    const redacted = redactSecrets(raw, ["token-secret-123456", "owner-password-2026"]);
    expect(redacted).toBe("request token=[REDACTED] password=[REDACTED]");
  });

  it("allows only explicitly approved deterministic fixture values", () => {
    expect(() =>
      scanText("owner-e2e-password-2026", {
        source: "fixture",
        approved: ["owner-e2e-password-2026"],
      }),
    ).not.toThrow();
  });

  it("does not mistake typed fields or runtime credential expressions for embedded secrets", () => {
    expect(() =>
      scanText(
        "password?: string; const settings = { password: decodeURIComponent(url.password) };",
        { source: "smtp-probe.ts", approved: [] },
      ),
    ).not.toThrow();
  });

  it("scans a source snapshot when Git metadata is unavailable", async () => {
    const snapshot = await mkdtemp(join(tmpdir(), "dls-secret-snapshot-"));
    try {
      const approval = resolve(snapshot, "ops/security/approved-test-secrets.json");
      await mkdir(dirname(approval), { recursive: true });
      await writeFile(approval, '{"version":1,"values":[]}\n', "utf8");
      await writeFile(resolve(snapshot, "safe.txt"), "no credentials here\n", "utf8");

      await expect(
        run(
          process.execPath,
          [
            resolve(root, "node_modules/tsx/dist/cli.mjs"),
            resolve(root, "tests/security/secret-scan.ts"),
            snapshot,
          ],
          { cwd: root, encoding: "utf8" },
        ),
      ).resolves.toMatchObject({ stdout: "" });
    } finally {
      await rm(snapshot, { recursive: true, force: true });
    }
  });
});
