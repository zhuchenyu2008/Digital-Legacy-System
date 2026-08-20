import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const run = promisify(execFile);

describe("Linux container acceptance", () => {
  it("describes a non-nested-Docker parity gate and its evidence artifact", async () => {
    const result = await run(
      process.execPath,
      ["ops/scripts/container-acceptance.mjs", "--describe"],
      {
        cwd: root,
        encoding: "utf8",
      },
    );
    const manifest = JSON.parse(result.stdout) as {
      evidencePath: string;
      evidenceFormatCommand: readonly string[];
      gates: readonly Readonly<{ name: string; command: readonly string[] }>[];
    };

    expect(manifest.evidencePath).toBe("docs/acceptance/linux-container-evidence.json");
    expect(manifest.evidenceFormatCommand).toEqual([
      "node",
      "node_modules/@biomejs/biome/bin/biome",
      "format",
      "--write",
      "docs/acceptance/linux-container-evidence.json",
    ]);
    expect(manifest.gates.map((gate) => gate.name)).toEqual([
      "versions",
      "format",
      "unit",
      "domain-mutations",
      "crypto",
      "storage-filesystem",
      "email",
      "build",
      "openapi",
      "security-core",
      "deployment",
      "stack-smoke",
      "evidence-parity",
    ]);
    expect(manifest.gates.find((gate) => gate.name === "format")?.command.join(" ")).toContain(
      "node ops/scripts/typecheck-readonly.mjs",
    );
    expect(manifest.gates.flatMap((gate) => gate.command).join(" ")).not.toMatch(/\bdocker\b/iu);
    expect(manifest.gates.find((gate) => gate.name === "build")?.command).toEqual([
      "node",
      "ops/scripts/verify-build-artifacts.mjs",
    ]);

    const verified = JSON.parse(
      (
        await run(process.execPath, ["ops/scripts/verify-build-artifacts.mjs"], {
          cwd: root,
          encoding: "utf8",
        })
      ).stdout,
    ) as { verified?: readonly string[] };
    expect(verified.verified).toEqual(
      expect.arrayContaining([
        "apps/api/dist/main.js",
        "apps/worker/dist/main.js",
        "apps/web/.next/BUILD_ID",
        "packages/application/dist/index.js",
        "packages/vss-wasm/dist/SHA256SUMS.json",
      ]),
    );

    const readonlyTypecheck = JSON.parse(
      (
        await run(process.execPath, ["ops/scripts/typecheck-readonly.mjs"], {
          cwd: root,
          encoding: "utf8",
        })
      ).stdout,
    ) as { checkedProjects?: number };
    expect(readonlyTypecheck.checkedProjects).toBeGreaterThan(0);

    const metadata = JSON.parse(
      (
        await run(process.execPath, ["ops/scripts/release-metadata.mjs"], {
          cwd: root,
          encoding: "utf8",
        })
      ).stdout,
    ) as { hashes: Record<string, string> };
    const temporary = await mkdtemp(resolve(tmpdir(), "dls-evidence-parity-"));
    const hostEvidence = resolve(temporary, "host.md");
    await writeFile(
      hostEvidence,
      [
        `- Protocol SHA-256: \`${metadata.hashes.protocolSha256}\``,
        `- Vectors SHA-256: \`${metadata.hashes.vectorsSha256}\``,
        `- Application SHA-256: \`${metadata.hashes.applicationSha256}\``,
      ].join("\n"),
      "utf8",
    );
    await expect(
      run(process.execPath, ["ops/scripts/verify-evidence-parity.mjs", "--host", hostEvidence], {
        cwd: root,
        encoding: "utf8",
      }),
    ).resolves.toMatchObject({ stdout: expect.stringContaining('"matched":true') });

    await writeFile(hostEvidence, "- Protocol SHA-256: `bad`\n", "utf8");
    await expect(
      run(process.execPath, ["ops/scripts/verify-evidence-parity.mjs", "--host", hostEvidence], {
        cwd: root,
        encoding: "utf8",
      }),
    ).rejects.toThrow(/evidence|hash|command failed/iu);
  }, 30_000);
});
