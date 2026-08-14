import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const run = promisify(execFile);

describe("release tooling pins and browser coverage", () => {
  it("resolves Corepack independently from a portable Node runtime", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dls-toolchain-"));
    try {
      const toolsDirectory = join(directory, "tools");
      const corepackCli = join(toolsDirectory, "node_modules", "corepack", "dist", "corepack.js");
      await mkdir(resolve(corepackCli, ".."), { recursive: true });
      await writeFile(corepackCli, "// fixture\n", "utf8");
      const { resolveCorepackCli } = await import("../../ops/scripts/toolchain-runtime.mjs");

      expect(
        resolveCorepackCli({
          execPath: join(directory, "portable-node", "node"),
          environment: { PATH: [toolsDirectory, join(directory, "missing")].join(delimiter) },
        }),
      ).toBe(corepackCli);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("resolves Corepack from the standard Node installation prefix", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dls-toolchain-prefix-"));
    try {
      const prefix = join(directory, "usr", "local");
      const corepackCli = join(prefix, "lib", "node_modules", "corepack", "dist", "corepack.js");
      await mkdir(resolve(corepackCli, ".."), { recursive: true });
      await writeFile(corepackCli, "// fixture\n", "utf8");
      const { resolveCorepackCli } = await import("../../ops/scripts/toolchain-runtime.mjs");

      expect(
        resolveCorepackCli({
          execPath: join(prefix, "bin", "node"),
          environment: { PATH: join(prefix, "bin") },
        }),
      ).toBe(corepackCli);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("verifies exact toolchain, migration, protocol, and image pins", async () => {
    const metadata = await readFile(resolve(root, "ops/scripts/release-metadata.mjs"), "utf8");
    expect(metadata).toContain('"--verify"');
    expect(metadata).toContain("process.version");
    expect(metadata).toContain("packageManager");
    expect(metadata).toContain("rust-toolchain.toml");
    expect(metadata).toContain("migrations");
    expect(metadata).toContain("protocolVersion");
    expect(metadata).toMatch(/sha256/iu);
  });

  it("emits deterministic protocol, vector, and application source hashes", async () => {
    const first = JSON.parse(
      (
        await run(process.execPath, ["ops/scripts/release-metadata.mjs"], {
          cwd: root,
          encoding: "utf8",
        })
      ).stdout,
    ) as { hashes?: Record<string, string> };
    const second = JSON.parse(
      (
        await run(process.execPath, ["ops/scripts/release-metadata.mjs"], {
          cwd: root,
          encoding: "utf8",
        })
      ).stdout,
    ) as { hashes?: Record<string, string> };

    expect(first.hashes).toEqual(second.hashes);
    expect(first.hashes).toEqual({
      protocolSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
      vectorsSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
      applicationSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
  });

  it("pins the Trivy 0.73.0 OCI index by immutable registry digest", async () => {
    const config = await readFile(resolve(root, "ops/security/trivy.yaml"), "utf8");

    expect(config).toContain("image: aquasec/trivy:0.73.0");
    expect(config).not.toContain("REPLACE_WITH_REGISTRY_DIGEST");
    expect(config).toContain(
      'digest: "sha256:7cced7cae583819fc7806d4cbc0dbbc7cad18b99f7d3e235192e6da8c091045c"',
    );
  });

  it("rebuilds Caddy 2.11.4 with patched Go dependencies in a minimal pinned runtime", async () => {
    const dockerfile = await readFile(resolve(root, "Dockerfile"), "utf8");
    const compose = await readFile(resolve(root, "compose.yaml"), "utf8");
    const caddyModule = await readFile(resolve(root, "ops/caddy/builder/go.mod"), "utf8");

    expect(dockerfile).toContain(
      "ARG CADDY_BUILD_IMAGE=golang:1.26.6-alpine3.24@sha256:af8d6740070b8906d12eae1c3e3ea0957fb63f492051ea05e354c38ef9fe88df",
    );
    expect(dockerfile).toContain(
      "ARG CADDY_RUNTIME_IMAGE=alpine:3.24.1@sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b",
    );
    expect(caddyModule).toContain("github.com/caddyserver/caddy/v2 v2.11.4");
    expect(caddyModule).toContain("golang.org/x/net v0.56.0");
    expect(caddyModule).toContain("golang.org/x/text v0.39.0");
    expect(caddyModule).toContain("google.golang.org/grpc v1.82.1");
    expect(dockerfile).toContain("-X github.com/caddyserver/caddy/v2.CustomVersion=v2.11.4");
    expect(dockerfile).toMatch(
      /for attempt in 1 2 3; do[\s\S]*go mod download[\s\S]*attempt.*-eq 3[\s\S]*exit 1/iu,
    );
    const runtimeStage = `FROM \${CADDY_RUNTIME_IMAGE} AS caddy`;
    expect(dockerfile).toContain(runtimeStage);
    expect(dockerfile).not.toContain(`FROM \${CADDY_IMAGE} AS caddy`);
    const caddyRuntime = dockerfile.slice(dockerfile.indexOf(runtimeStage));
    expect(caddyRuntime).toMatch(/apk add --no-cache[^\r\n]*ca-certificates[^\r\n]*tzdata/u);
    expect(caddyRuntime).not.toMatch(/apk add --no-cache[^\r\n]*(?:curl|c-ares)/u);
    expect(compose).toContain("CADDY_BUILD_IMAGE: golang:1.26.6-alpine3.24@sha256:");
    expect(compose).toContain("CADDY_RUNTIME_IMAGE: alpine:3.24.1@sha256:");
  });

  it("defines mobile Chromium plus Firefox and WebKit smoke projects", async () => {
    const config = await readFile(resolve(root, "tests/e2e/playwright.config.ts"), "utf8");

    expect(config).toContain('name: "mobile-chromium"');
    expect(config).toContain('devices["Pixel 7"]');
    expect(config).toContain('name: "firefox-smoke"');
    expect(config).toContain('devices["Desktop Firefox"]');
    expect(config).toContain('name: "webkit-smoke"');
    expect(config).toContain('devices["Desktop Safari"]');
    expect(config.match(/testMatch: "09-browser-smoke\.spec\.ts"/gu)).toHaveLength(3);
  });

  it("runs the pinned scanner against the repository and every release image", async () => {
    const dockerfile = await readFile(resolve(root, "Dockerfile"), "utf8");
    const powershell = await readFile(resolve(root, "ops/scripts/security-scan.ps1"), "utf8");
    const posix = await readFile(resolve(root, "ops/scripts/security-scan.sh"), "utf8");
    expect(dockerfile).toContain("AS rust-audit");
    expect(dockerfile).toContain("cargo-audit --version 0.22.2 --locked");
    for (const script of [powershell, posix]) {
      expect(script).toContain("aquasec/trivy:0.73.0@");
      expect(script).not.toMatch(/trivy[^\r\n]*--config/iu);
      expect(script).toMatch(/\bfs\b/iu);
      expect(script).toMatch(/\bimage\b/iu);
      expect(script).toContain("--target rust-audit");
      expect(script).toMatch(/dls-e2e-security-/u);
      expect(script).not.toMatch(/--project-name\s+["']?dls-local-v1\b/u);
      for (const service of ["api", "worker", "web", "caddy"]) {
        expect(script).toMatch(new RegExp(`(?:project|PROJECT)[}-]?-${service}`, "u"));
      }
    }
  });

  it("runs maintenance CLIs directly without cross-shell quoting", async () => {
    for (const [file, cli] of [
      ["verify-restore.ps1", "verify-audit.mjs"],
      ["deploy.ps1", "verify-audit.mjs"],
      ["rollback.ps1", "migration-status.mjs"],
    ] as const) {
      const script = await readFile(resolve(root, "ops/scripts", file), "utf8");
      expect(script).toContain(`--entrypoint node migrator ops/scripts/${cli}`);
      expect(script).not.toMatch(/--entrypoint \/bin\/sh[^\r\n]*migrator/iu);
    }
  });
});
