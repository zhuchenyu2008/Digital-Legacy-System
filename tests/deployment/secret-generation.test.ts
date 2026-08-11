import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertX25519KeyPair } from "@dls/crypto/node";
import { describe, expect, test } from "vitest";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const generator = resolve(workspaceRoot, "ops/scripts/generate-development-secrets.mjs");

const expectedFiles = [
  "api-db-password",
  "backup-db-password",
  "health-db-password",
  "migrator-db-password",
  "minio-access-key",
  "minio-secret-key",
  "postgres-superuser-password",
  "recovery-ingress-private-key",
  "recovery-ingress-public-key",
  "recovery-stage-kek",
  "release-ingress-private-key",
  "release-ingress-public-key",
  "release-stage-kek",
  "session-secret",
  "session-pepper",
  "setup-token",
  "token-pepper",
  "worker-db-password",
] as const;

function generate(directory: string, rotate = false): void {
  execFileSync(
    process.execPath,
    [generator, "--directory", directory, ...(rotate ? ["--rotate"] : [])],
    {
      cwd: workspaceRoot,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

function read(directory: string, name: (typeof expectedFiles)[number]): string {
  return readFileSync(join(directory, name), "utf8");
}

describe("development secret generation", () => {
  test("creates complete, matching capabilities once and never overwrites them", async () => {
    const directory = mkdtempSync(join(tmpdir(), "dls-secrets-"));
    try {
      generate(directory);
      const first = new Map(expectedFiles.map((name) => [name, read(directory, name)]));
      generate(directory);
      const second = new Map(expectedFiles.map((name) => [name, read(directory, name)]));

      expect(second).toEqual(first);
      for (const name of expectedFiles) expect(first.get(name)).toBeTruthy();

      for (const purpose of ["release", "recovery"] as const) {
        const publicKey = Buffer.from(first.get(`${purpose}-ingress-public-key`) ?? "", "base64");
        const privateKey = Buffer.from(first.get(`${purpose}-ingress-private-key`) ?? "", "base64");
        expect(publicKey).toHaveLength(32);
        expect(privateKey).toHaveLength(32);
        await expect(assertX25519KeyPair({ publicKey, privateKey })).resolves.toBeUndefined();
      }

      expect(Buffer.from(first.get("release-stage-kek") ?? "", "base64")).toHaveLength(32);
      expect(Buffer.from(first.get("recovery-stage-kek") ?? "", "base64")).toHaveLength(32);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("rotates all production capabilities only when explicitly requested", async () => {
    const directory = mkdtempSync(join(tmpdir(), "dls-secrets-rotate-"));
    try {
      generate(directory);
      const firstSession = read(directory, "session-secret");
      const firstReleasePublic = read(directory, "release-ingress-public-key");
      generate(directory);
      expect(read(directory, "session-secret")).toBe(firstSession);
      expect(read(directory, "release-ingress-public-key")).toBe(firstReleasePublic);

      generate(directory, true);
      expect(read(directory, "session-secret")).not.toBe(firstSession);
      expect(read(directory, "release-ingress-public-key")).not.toBe(firstReleasePublic);
      await expect(
        assertX25519KeyPair({
          publicKey: Buffer.from(read(directory, "release-ingress-public-key"), "base64"),
          privateKey: Buffer.from(read(directory, "release-ingress-private-key"), "base64"),
        }),
      ).resolves.toBeUndefined();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
