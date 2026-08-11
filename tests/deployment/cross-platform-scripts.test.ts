import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertNoRequiredTestSkips,
  assertRequiredGateResults,
  renderEvidence,
} from "../../ops/scripts/write-evidence.js";

const root = resolve(import.meta.dirname, "../..");

describe("cross-platform operational scripts", () => {
  it("ships both acceptance entry points and preserves the required gate order", async () => {
    const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    const webPackageJson = JSON.parse(
      await readFile(resolve(root, "apps/web/package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };
    const powershell = await readFile(resolve(root, "ops/scripts/acceptance.ps1"), "utf8");
    const posix = await readFile(resolve(root, "ops/scripts/acceptance.sh"), "utf8");
    expect(packageJson.scripts?.["test:full-stack-e2e"]).toContain(
      "--config tests/e2e/playwright.config.ts",
    );
    expect(packageJson.scripts?.typecheck).toContain("@dls/web typegen");
    expect(packageJson.scripts?.typecheck).toContain("tsc -b");
    expect(packageJson.scripts?.["test:publication-crash-matrix"]).toContain(
      "--config vitest.faults.config.ts",
    );
    expect(webPackageJson.scripts?.typegen).toBe("next typegen");
    for (const script of [powershell, posix]) {
      expect(script).toMatch(/write-evidence/iu);
      expect(script).toMatch(/format|lint|check/iu);
      expect(script).toContain("pnpm typecheck");
      expect(script).toMatch(/unit/iu);
      expect(script).toMatch(/integration/iu);
      expect(script).toMatch(/crypto/iu);
      expect(script).toMatch(/storage/iu);
      expect(script).toMatch(/e2e/iu);
      expect(script).toContain("test:full-stack-e2e");
      expect(script).toMatch(/security/iu);
      expect(script).toMatch(/backup|restore/iu);
      expect(script).toMatch(/Beijing|Asia\/Shanghai|北京时间/iu);
      expect(script).toMatch(/docker[^\r\n]*version/iu);
      expect(script).toContain("compose.prod.yaml");
      expect(script).toContain(".env.production.example");
      expect(script).toContain("trivy.yaml");
      expect(script).toMatch(/migration(?:s)?[- ](?:rehearsal|up[-/]down[-/]up)/iu);
      expect(script).toMatch(/concurrency/iu);
      expect(script).toMatch(/publication[- ]crash[- ]matrix/iu);
      expect(script).toMatch(/production[- ]compose/iu);
      expect(script).toMatch(/storage[- ]filesystem/iu);
      expect(script).toMatch(/storage[- ]s3/iu);
      expect(script).toMatch(/reconciliation/iu);
      expect(script).toContain("runtime-reconcile.mjs");
      expect(script).toContain("release-metadata.mjs");
    }
    const requiredOrder = [
      '"versions"',
      '"format"',
      '"unit"',
      '"migration-up-down-up"',
      '"integration"',
      '"concurrency"',
      '"crypto"',
      '"storage-filesystem"',
      '"storage-s3"',
      '"email"',
      '"build"',
      '"compose-smoke"',
      '"simulation"',
      '"visual"',
      '"a11y"',
      '"full-stack-e2e"',
      '"security"',
      '"publication-crash-matrix"',
      '"production-compose"',
      '"backup-blank-restore"',
      '"reconciliation"',
    ];
    for (const script of [powershell, posix]) {
      let previous = -1;
      for (const gate of requiredOrder) {
        const current = script.indexOf(gate);
        expect(current, `${gate} missing from acceptance script`).toBeGreaterThan(previous);
        previous = current;
      }
    }
    expect(powershell).toMatch(/blocked|Skip-RemainingGates/iu);
    expect(posix).toMatch(/blocked|skip_remaining_gates/iu);
    expect(posix).toContain("bash ops/scripts/backup-restore-smoke.sh");
  });

  it("includes the three operational readiness runbooks", async () => {
    for (const file of [
      "incident-response.md",
      "monitoring-alerts.md",
      "production-readiness.md",
    ]) {
      const text = await readFile(resolve(root, "docs/operations", file), "utf8");
      expect(text.length).toBeGreaterThan(500);
    }
  });

  it("uses unique disposable Compose project names for destructive acceptance cleanup", async () => {
    const backupPowerShell = await readFile(
      resolve(root, "ops/scripts/backup-restore-smoke.ps1"),
      "utf8",
    );
    const backupPosix = await readFile(
      resolve(root, "ops/scripts/backup-restore-smoke.sh"),
      "utf8",
    );
    const s3PowerShell = await readFile(
      resolve(root, "ops/scripts/storage-s3-contract.ps1"),
      "utf8",
    );
    const s3Posix = await readFile(resolve(root, "ops/scripts/storage-s3-contract.sh"), "utf8");
    const composePowerShell = await readFile(
      resolve(root, "ops/scripts/compose-smoke.ps1"),
      "utf8",
    );
    const composePosix = await readFile(resolve(root, "ops/scripts/compose-smoke.sh"), "utf8");

    for (const script of [backupPowerShell, s3PowerShell, composePowerShell]) {
      expect(script).toContain("[guid]::NewGuid()");
      expect(script).toMatch(/dls-[a-z0-9-]+-\$runId/u);
    }
    for (const script of [backupPosix, s3Posix, composePosix]) {
      expect(script).toContain("crypto.randomUUID()");
      expect(script).toMatch(/dls-[a-z0-9-]+-\$\{RUN_ID\}/u);
    }
    const acceptancePowerShell = await readFile(
      resolve(root, "ops/scripts/acceptance.ps1"),
      "utf8",
    );
    const acceptancePosix = await readFile(resolve(root, "ops/scripts/acceptance.sh"), "utf8");
    expect(acceptancePowerShell).toContain("compose-smoke.ps1 -DeleteVolumes");
    expect(acceptancePosix).toContain("compose-smoke.sh --delete-volumes");
  });

  it("renders per-gate test counts and artifact digests into acceptance evidence", async () => {
    const temporary = await mkdtemp(resolve(tmpdir(), "dls-evidence-"));
    const artifacts = resolve(temporary, "artifacts");
    await mkdir(artifacts, { recursive: true });
    const vitestLog = resolve(artifacts, "security.log");
    const playwrightLog = resolve(artifacts, "e2e.log");
    await writeFile(vitestLog, "Test Files 8 passed (8)\nTests 17 passed (17)\n");
    await writeFile(playwrightLog, "9 passed (2.0m)\n");
    await writeFile(resolve(temporary, "package.json"), "{}\n");

    const evidence = await renderEvidence(
      {
        startedAt: "2026-08-10T00:00:00.000Z",
        endedAt: "2026-08-10T00:01:00.000Z",
        timezone: "Asia/Shanghai",
        gates: [
          {
            name: "security",
            command: "pnpm test:security",
            status: "passed",
            exitCode: 0,
            durationMs: 1,
            startedAt: "2026-08-10T00:00:00.000Z",
            endedAt: "2026-08-10T00:00:01.000Z",
            outputFile: vitestLog,
          },
          {
            name: "e2e",
            command: "pnpm test:e2e",
            status: "passed",
            exitCode: 0,
            durationMs: 2,
            startedAt: "2026-08-10T00:00:01.000Z",
            endedAt: "2026-08-10T00:00:03.000Z",
            outputFile: playwrightLog,
          },
        ],
        artifacts: ["package.json"],
        toolVersions: { trivy: "aquasec/trivy:0.73.0@sha256:abc" },
        system: { os: "test-os", architecture: "test-arch" },
        releaseVersions: {
          migration: "018",
          protocol: "1",
          images: ["node:24.18.0@sha256:abc", "rust:1.97.1@sha256:def"],
          hashes: {
            protocolSha256: "1".repeat(64),
            vectorsSha256: "2".repeat(64),
            applicationSha256: "3".repeat(64),
          },
        },
      },
      temporary,
    );

    expect(evidence).toContain("17 passed");
    expect(evidence).toContain("9 passed");
    expect(evidence).toContain("Artifact SHA-256");
    expect(evidence).toContain("aquasec/trivy:0.73.0@sha256:abc");
    expect(evidence).toContain("test-os / test-arch");
    expect(evidence).toContain("迁移版本: `018`");
    expect(evidence).toContain("协议版本: `1`");
    expect(evidence).toContain("node:24.18.0@sha256:abc");
    expect(evidence).toContain(`Protocol SHA-256: \`${"1".repeat(64)}\``);
    expect(evidence).toContain(`Vectors SHA-256: \`${"2".repeat(64)}\``);
    expect(evidence).toContain(`Application SHA-256: \`${"3".repeat(64)}\``);
    expect(evidence).not.toContain("鈥");
  });

  it("fails evidence generation when a declared artifact is missing", async () => {
    const temporary = await mkdtemp(resolve(tmpdir(), "dls-evidence-missing-"));
    await expect(
      renderEvidence(
        {
          startedAt: "2026-08-10T00:00:00.000Z",
          endedAt: "2026-08-10T00:01:00.000Z",
          timezone: "Asia/Shanghai",
          gates: [],
          artifacts: ["missing.json"],
        },
        temporary,
      ),
    ).rejects.toThrow(/missing.*artifact|artifact.*missing/iu);
  });

  it("rejects failed or skipped required gates after preserving their evidence", () => {
    expect(() =>
      assertRequiredGateResults([
        {
          name: "full-stack-e2e",
          command: "pnpm test:full-stack-e2e",
          status: "skipped",
          exitCode: null,
          durationMs: 0,
          startedAt: "2026-08-10T00:00:00.000Z",
          endedAt: "2026-08-10T00:00:00.000Z",
        },
      ]),
    ).toThrow(/required acceptance gates incomplete.*full-stack-e2e/iu);
  });

  it("rejects required test output that reports skipped tests", () => {
    expect(() =>
      assertNoRequiredTestSkips("Test Files 1 passed (1)\nTests 4 passed (4) | 1 skipped (5)\n"),
    ).toThrow(/required tests skipped/iu);

    expect(() =>
      assertNoRequiredTestSkips("Test Files 1 passed (1)\nTests 4 passed (4)\n"),
    ).not.toThrow();
  });
});
