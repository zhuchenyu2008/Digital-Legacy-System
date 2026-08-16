import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("ordinary database backup encryption", () => {
  it("authenticates a streaming encrypted dump and rejects tampering", async () => {
    const root = await mkdtemp(join(tmpdir(), "dls-database-backup-"));
    const plaintextDirectory = join(root, "system-temporary");
    const backupDirectory = join(root, "backup-media");
    const input = join(plaintextDirectory, "database.plain");
    const encrypted = join(backupDirectory, "database.dump");
    const restored = join(plaintextDirectory, "database.restored");
    const key = join(root, "data-backup-key");
    const content = Buffer.concat([Buffer.from("sensitive-pg-dump-marker"), randomBytes(65_536)]);
    const script = join(process.cwd(), "ops/scripts/backup-artifact-crypto.mjs");
    try {
      await mkdir(plaintextDirectory);
      await mkdir(backupDirectory);
      await writeFile(input, content);
      await writeFile(key, `${randomBytes(32).toString("base64")}\n`);
      await execFileAsync(process.execPath, [
        script,
        "encrypt",
        "--input",
        input,
        "--output",
        encrypted,
        "--key-file",
        key,
      ]);
      const ciphertext = await readFile(encrypted);
      expect(ciphertext.includes(Buffer.from("sensitive-pg-dump-marker"))).toBe(false);
      await execFileAsync(process.execPath, [
        script,
        "verify",
        "--input",
        encrypted,
        "--key-file",
        key,
      ]);
      await execFileAsync(process.execPath, [
        script,
        "decrypt",
        "--input",
        encrypted,
        "--output",
        restored,
        "--key-file",
        key,
      ]);
      await expect(readFile(restored)).resolves.toEqual(content);

      const tamperIndex = Math.floor(ciphertext.length / 2);
      ciphertext[tamperIndex] = (ciphertext[tamperIndex] ?? 0) ^ 1;
      await writeFile(encrypted, ciphertext);
      await expect(
        execFileAsync(process.execPath, [
          script,
          "verify",
          "--input",
          encrypted,
          "--key-file",
          key,
        ]),
      ).rejects.toBeTruthy();
    } finally {
      content.fill(0);
      await rm(root, { recursive: true, force: true });
    }
  });
});
