import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");

describe("production unattended operations", () => {
  it("installs persistent Beijing-time backup and restore-drill timers", async () => {
    const [installer, backupTimer, restoreTimer] = await Promise.all([
      readFile(resolve(root, "ops/scripts/install-production-automation.sh"), "utf8"),
      readFile(resolve(root, "ops/systemd/dls-backup.timer"), "utf8"),
      readFile(resolve(root, "ops/systemd/dls-restore-drill.timer"), "utf8"),
    ]);
    expect(installer).toContain("systemctl enable --now dls-backup.timer dls-restore-drill.timer");
    expect(installer).toContain("systemctl start --no-block dls-backup.service");
    for (const timer of [backupTimer, restoreTimer]) {
      expect(timer).toContain("Asia/Shanghai");
      expect(timer).toContain("Persistent=true");
      expect(timer).toContain("WantedBy=timers.target");
    }
  });

  it("uses verified atomic backups, isolated real restores, and machine-readable status", async () => {
    const [backup, restore] = await Promise.all([
      readFile(resolve(root, "ops/scripts/scheduled-backup.sh"), "utf8"),
      readFile(resolve(root, "ops/scripts/scheduled-restore-drill.sh"), "utf8"),
    ]);
    expect(backup).toContain("backup root must use a failure domain outside");
    expect(backup).toContain('backup-manifest.ts" verify-artifacts');
    expect(backup).toMatch(/mv -- "\$PARTIAL" "\$FINAL"/u);
    expect(backup).toContain("--status ok");
    expect(backup).toContain("--status failed");
    expect(restore).toContain("dls-restore-drill-");
    expect(restore).toContain("restore.sh");
    expect(restore).toContain("verify-restore.sh");
    expect(restore).toContain("compose down --remove-orphans --volumes");
    expect(restore).toContain("--status ok");
    expect(restore).toContain("--status failed");
  });

  it("requires explicit real SMTP acceptance recipients instead of treating the sender as one", async () => {
    const smtpAcceptance = await readFile(resolve(root, "ops/scripts/smtp-acceptance.mjs"), "utf8");
    expect(smtpAcceptance).toContain('option("--primary", args) ?? config.SMTP_ACCEPTANCE_PRIMARY');
    expect(smtpAcceptance).not.toContain("config.SMTP_ACCEPTANCE_PRIMARY ?? config.SMTP_USER");
    expect(smtpAcceptance).toContain("a distinct --backup recipient is required");
  });
});
