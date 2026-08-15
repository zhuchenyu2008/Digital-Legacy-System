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
    const output = join(root, "bundle.enc");
    const keyFile = join(root, "backup.key");
    const secret = "synthetic-secret-value";
    try {
      await mkdir(source, { recursive: true });
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
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
