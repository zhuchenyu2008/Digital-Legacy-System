import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("production secrets backup", () => {
  it("encrypts and restores a secrets directory without printing secret values", async () => {
    const root = await mkdtemp(join(tmpdir(), "dls-secrets-backup-"));
    const source = join(root, "source");
    const target = join(root, "target");
    const media = join(root, "media");
    const offline = join(root, "offline");
    const output = join(media, "bundle.enc");
    const keyFile = join(offline, "backup.key");
    const secret = "synthetic-secret-value";
    try {
      await mkdir(source, { recursive: true });
      await mkdir(offline, { recursive: true });
      await writeFile(join(source, "session-secret"), secret, { encoding: "utf8" });
      await writeFile(keyFile, `${randomBytes(32).toString("base64")}\n`, { encoding: "utf8" });
      const script = join(process.cwd(), "ops/scripts/secrets-backup.mjs");
      const backup = await execFileAsync(process.execPath, [
        script,
        "backup",
        "--source",
        source,
        "--output",
        output,
        "--key-file",
        keyFile,
      ]);
      expect(backup.stdout).not.toContain(secret);
      const verify = await execFileAsync(process.execPath, [
        script,
        "verify",
        "--bundle",
        output,
        "--key-file",
        keyFile,
      ]);
      expect(verify.stdout).not.toContain(secret);
      const restore = await execFileAsync(process.execPath, [
        script,
        "restore",
        "--bundle",
        output,
        "--target",
        target,
        "--key-file",
        keyFile,
      ]);
      expect(restore.stdout).not.toContain(secret);
      await expect(readFile(join(target, "session-secret"), "utf8")).resolves.toBe(secret);
      const manifest = JSON.parse(await readFile(`${output}.manifest.json`, "utf8"));
      expect(manifest).toMatchObject({
        containsPlaintextSecrets: false,
        containsBackupKey: false,
        keyStorageRequirement: "separate-offline-failure-domain",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a production key stored in the same backup failure domain", async () => {
    const root = await mkdtemp(join(tmpdir(), "dls-secrets-boundary-"));
    const source = join(root, "source");
    const media = join(root, "media");
    const keyFile = join(media, "backup.key");
    try {
      await mkdir(source, { recursive: true });
      await mkdir(media, { recursive: true });
      await writeFile(join(source, "session-secret"), "secret", "utf8");
      await writeFile(keyFile, `${randomBytes(32).toString("base64")}\n`, "utf8");
      const script = join(process.cwd(), "ops/scripts/secrets-backup.mjs");
      await expect(
        execFileAsync(process.execPath, [
          script,
          "backup",
          "--source",
          source,
          "--output",
          join(media, "bundle.enc"),
          "--key-file",
          keyFile,
          "--production",
          "--media-root",
          media,
        ]),
      ).rejects.toMatchObject({ stderr: expect.stringContaining("backup encryption key") });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
