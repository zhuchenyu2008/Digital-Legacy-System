import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { FilesystemStorage } from "@dls/storage";
import { describe, expect, it } from "vitest";
import * as backupManifest from "../../ops/scripts/backup-manifest.js";
import {
  compareDatabaseInventories,
  verifyDatabaseObjectReferences,
} from "../../ops/scripts/database-inventory.js";
import { materializeDatabaseReferencedObjects } from "../../ops/scripts/materialize-s3-backup.js";

const root = resolve(import.meta.dirname, "../..");
const { createBackupManifest, verifyBackupArtifacts, verifyRestoredObjects } = backupManifest;

function tarArchive(
  entries: readonly Readonly<{
    name: string;
    body?: string;
    type?: "0" | "1" | "2" | "5";
    linkName?: string;
  }>[],
): Uint8Array {
  const chunks: Buffer[] = [];
  const writeText = (header: Buffer, offset: number, length: number, value: string) => {
    const encoded = Buffer.from(value, "utf8");
    if (encoded.length > length) throw new Error("test tar field is too long");
    encoded.copy(header, offset);
  };
  const writeOctal = (header: Buffer, offset: number, length: number, value: number) => {
    writeText(header, offset, length, value.toString(8).padStart(length - 1, "0"));
  };
  for (const entry of entries) {
    const body = Buffer.from(entry.body ?? "", "utf8");
    const header = Buffer.alloc(512);
    writeText(header, 0, 100, entry.name);
    writeOctal(header, 100, 8, 0o600);
    writeOctal(header, 108, 8, 1_000);
    writeOctal(header, 116, 8, 1_000);
    writeOctal(header, 124, 12, body.length);
    writeOctal(header, 136, 12, 0);
    header.fill(0x20, 148, 156);
    header[156] = (entry.type ?? "0").charCodeAt(0);
    writeText(header, 157, 100, entry.linkName ?? "");
    writeText(header, 257, 6, "ustar");
    writeText(header, 263, 2, "00");
    const checksum = [...header].reduce((sum, byte) => sum + byte, 0);
    const checksumText = `${checksum.toString(8).padStart(6, "0")}\0 `;
    Buffer.from(checksumText, "ascii").copy(header, 148);
    chunks.push(header, body);
    const padding = (512 - (body.length % 512)) % 512;
    if (padding > 0) chunks.push(Buffer.alloc(padding));
  }
  chunks.push(Buffer.alloc(1_024));
  return Buffer.concat(chunks);
}

describe("backup and restore operator boundaries", () => {
  it("rejects links and unsafe paths before a restore archive can be extracted", () => {
    type ValidateTarArchive = (archive: Uint8Array) => void;
    const validate = (backupManifest as unknown as { validateTarArchive?: ValidateTarArchive })
      .validateTarArchive;
    expect(validate).toBeTypeOf("function");
    if (validate === undefined) throw new Error("validateTarArchive is unavailable");

    expect(() =>
      validate(
        tarArchive([
          { name: "./", type: "5" },
          { name: "./private/aa/item", body: "ciphertext" },
        ]),
      ),
    ).not.toThrow();
    for (const entry of [
      { name: "./private/link", type: "2" as const, linkName: "../../outside" },
      { name: "./private/hard", type: "1" as const, linkName: "private/aa/item" },
      { name: "../outside", type: "0" as const, body: "escape" },
      { name: "C:/outside", type: "0" as const, body: "escape" },
    ]) {
      expect(() => validate(tarArchive([entry]))).toThrow(/archive|link|path|unsafe/iu);
    }
  });

  it("reconciles schema, audit/outbox state, and database-referenced objects", () => {
    const inventory = {
      version: 1,
      schemaVersion: 18,
      counts: { packages: 1, publications: 1 },
      packages: [{ status: "ACTIVE", objectKey: "aa/item", bytes: 5, sha256: "a".repeat(64) }],
      publications: [{ objectKey: "legacy/item.zip", bytes: 7, sha256: "b".repeat(64) }],
      privateAuditFinalHash: "c".repeat(64),
      publicAuditFinalHashes: { publication: "d".repeat(64) },
      outbox: { pending: 0, published: 2 },
      jobs: { completed: 2, created: 1 },
    };
    const manifest = {
      objects: [
        { path: "private/aa/item", bytes: 5, sha256: "a".repeat(64) },
        { path: "public/legacy/item.zip", bytes: 7, sha256: "b".repeat(64) },
      ],
    };

    expect(() => compareDatabaseInventories(inventory, structuredClone(inventory))).not.toThrow();
    expect(() => verifyDatabaseObjectReferences(inventory, manifest)).not.toThrow();
    expect(() =>
      verifyDatabaseObjectReferences(inventory, {
        objects: manifest.objects.filter((object) => !object.path.startsWith("public/")),
      }),
    ).toThrow(/publication|reference|missing|inconsistent/iu);
  });

  it("records artifact and per-object digests and reconciles a restored object tree", async () => {
    const temporary = await mkdtemp(resolve(tmpdir(), "dls-backup-manifest-"));
    const backup = resolve(temporary, "backup");
    const source = resolve(temporary, "source");
    const restored = resolve(temporary, "restored");
    await mkdir(resolve(source, "private", "nested"), { recursive: true });
    await mkdir(resolve(source, "public"), { recursive: true });
    await mkdir(backup, { recursive: true });
    await writeFile(resolve(source, "private", "nested", "a.bin"), "alpha");
    await writeFile(resolve(source, "public", "b.bin"), "beta");
    await writeFile(resolve(backup, "database.dump"), "database");
    await writeFile(resolve(backup, "objects.tar"), "archive");
    await writeFile(resolve(backup, "database-state.json"), '{"schemaVersion":18}\n');
    await writeFile(resolve(backup, "runtime.json"), '{"imageVersion":"test"}\n');

    const manifest = await createBackupManifest({
      backupDirectory: backup,
      objectRoot: source,
      project: "dls-test",
      createdAt: "2026-08-10T00:00:00.000Z",
    });
    expect(manifest.artifacts.map((artifact) => artifact.name)).toEqual([
      "database-state.json",
      "database.dump",
      "objects.tar",
      "runtime.json",
    ]);
    expect(manifest.objects.map((object) => object.path)).toEqual([
      "private/nested/a.bin",
      "public/b.bin",
    ]);
    await expect(verifyBackupArtifacts(backup)).resolves.toMatchObject({ project: "dls-test" });

    await mkdir(resolve(restored, "private", "nested"), { recursive: true });
    await mkdir(resolve(restored, "public"), { recursive: true });
    await writeFile(resolve(restored, "private", "nested", "a.bin"), "alpha");
    await writeFile(resolve(restored, "public", "b.bin"), "beta");
    await writeFile(resolve(restored, "MAINTENANCE"), "restore");
    await expect(verifyRestoredObjects(backup, restored)).resolves.toEqual({
      bytes: 9,
      objects: 2,
    });

    await writeFile(resolve(restored, "public", "b.bin"), "tampered");
    await expect(verifyRestoredObjects(backup, restored)).rejects.toThrow(/digest|size/iu);
  });

  it("materializes every database-referenced S3 namespace through the storage port", async () => {
    const temporary = await mkdtemp(resolve(tmpdir(), "dls-s3-backup-"));
    const sourceRoot = resolve(temporary, "source");
    const targetRoot = resolve(temporary, "target");
    const source = new FilesystemStorage({
      privateRoot: resolve(sourceRoot, "private"),
      stagingRoot: resolve(sourceRoot, "staging"),
      publicRoot: resolve(sourceRoot, "public"),
    });
    const privateKey = "aa/00/aa000000-0000-4000-8000-000000000001";
    const stagingKey = "bb/00/bb000000-0000-4000-8000-000000000002";
    const publicKey = `legacy/cc/${"cc"}${"0".repeat(62)}.zip`;
    const entries = [
      { namespace: "private" as const, key: privateKey, body: "private" },
      { namespace: "staging" as const, key: stagingKey, body: "staging" },
      { namespace: "public" as const, key: publicKey, body: "public" },
    ];
    for (const entry of entries) {
      const bytes = Buffer.from(entry.body);
      await source.put({
        namespace: entry.namespace,
        key: entry.key,
        body: (async function* () {
          yield bytes;
        })(),
        expectedBytes: bytes.length,
        expectedSha256: createHash("sha256").update(bytes).digest("hex"),
      });
    }
    const sha = (body: string) => createHash("sha256").update(body).digest("hex");
    await expect(
      materializeDatabaseReferencedObjects(
        {
          packages: [
            { status: "ACTIVE", objectKey: privateKey, bytes: 7, sha256: sha("private") },
            {
              status: "UPLOADING",
              objectKey: stagingKey,
              bytes: 7,
              sha256: sha("staging"),
            },
          ],
          publications: [
            {
              objectKey: publicKey,
              bytes: 6,
              sha256: sha("public"),
            },
          ],
        },
        source,
        targetRoot,
      ),
    ).resolves.toEqual({ objects: 3, bytes: 20 });
    await expect(readFile(resolve(targetRoot, "private", privateKey), "utf8")).resolves.toBe(
      "private",
    );
    await expect(readFile(resolve(targetRoot, "staging", stagingKey), "utf8")).resolves.toBe(
      "staging",
    );
    await expect(readFile(resolve(targetRoot, "public", publicKey), "utf8")).resolves.toBe(
      "public",
    );
  });

  it("runs storage CLIs with native Node and reaches their argument validation", () => {
    for (const [script, expectedError] of [
      ["materialize-s3-backup.ts", /usage: materialize-s3-backup/iu],
      ["migrate-storage.ts", /--maintenance-marker is required/iu],
      ["verify-storage.ts", /--manifest is required/iu],
    ] as const) {
      const result = spawnSync(process.execPath, [`ops/scripts/${script}`], {
        cwd: root,
        encoding: "utf8",
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(expectedError);
      expect(result.stderr).not.toMatch(/ERR_MODULE_NOT_FOUND/iu);
    }
  });

  it("requires explicit named targets, hashes every artifact, and refuses nonblank restore", async () => {
    const backup = await readFile(resolve(root, "ops/scripts/backup.ps1"), "utf8");
    const restore = await readFile(resolve(root, "ops/scripts/restore.ps1"), "utf8");
    const verify = await readFile(resolve(root, "ops/scripts/verify-restore.ps1"), "utf8");
    const manifest = await readFile(resolve(root, "ops/scripts/backup-manifest.ts"), "utf8");
    const inventorySql = await readFile(
      resolve(root, "ops/scripts/database-inventory.sql"),
      "utf8",
    );
    expect(backup).toContain("Destination");
    expect(manifest).toMatch(/sha256|createHash/iu);
    expect(backup).toMatch(/pg_dump/iu);
    expect(backup).toMatch(/quiescedServices[\s\S]*(?:api|worker)[\s\S]*Invoke-Compose stop/iu);
    expect(backup).toMatch(/database-state\.json/iu);
    expect(backup).toMatch(/runtime\.json/iu);
    expect(backup).toMatch(/runningServices|running_services/iu);
    expect(backup).toContain("backup-manifest.ts");
    expect(backup).toContain("materialize-s3-backup.ts");
    expect(backup).toMatch(/StorageDriver|storage-driver/iu);
    expect(restore).toMatch(/NonBlank|non.?blank|Destructive/iu);
    expect(restore).toMatch(/maintenance/iu);
    expect(restore).toMatch(/pg_restore/iu);
    expect(restore).toContain("EnvFile");
    expect(verify).toContain("EnvFile");
    expect(restore).not.toMatch(/Get-ChildItem[^\r\n]*-File/iu);
    const databaseTargetCheck = restore.indexOf("$databaseObjects");
    const destructiveObjectRemoval = restore.indexOf("Remove-Item -Recurse -Force");
    expect(databaseTargetCheck).toBeGreaterThan(-1);
    expect(destructiveObjectRemoval).toBeGreaterThan(databaseTargetCheck);
    expect(verify).toContain("verify-objects");
    expect(verify).toMatch(/database-state|database inventory/iu);
    expect(verify).toMatch(/schema.*migration|migration.*schema/isu);
    expect(verify).toMatch(/publication/iu);
    expect(verify).toMatch(/outbox|job/iu);
    expect(inventorySql).toContain("'jobs'");
    expect(verify).toMatch(/audit.*private|private.*audit/isu);
    expect(verify).toMatch(/audit.*public|public.*audit/isu);
    for (const script of [backup, restore, verify]) {
      expect(script).not.toContain("node_modules/tsx");
    }
    expect(verify).toContain("ops/scripts/verify-audit.mjs");
  });

  it("has equivalent POSIX backup, restore, and verification entry points", async () => {
    for (const file of ["backup.sh", "restore.sh", "verify-restore.sh"]) {
      const text = await readFile(resolve(root, "ops/scripts", file), "utf8");
      expect(text).toContain("set -Eeuo pipefail");
      expect(text).toMatch(/manifest|sha256|verify/iu);
    }
    const restore = await readFile(resolve(root, "ops/scripts/restore.sh"), "utf8");
    const backup = await readFile(resolve(root, "ops/scripts/backup.sh"), "utf8");
    const verify = await readFile(resolve(root, "ops/scripts/verify-restore.sh"), "utf8");
    expect(backup).toContain("materialize-s3-backup.ts");
    expect(backup).toContain("--storage-driver");
    expect(restore).toContain("--env-file");
    expect(verify).toContain("--env-file");
    expect(restore).not.toMatch(/find[^\r\n]*-type f/iu);
    expect(restore.indexOf("rm -rf --")).toBeGreaterThan(restore.indexOf("database_objects="));
    expect(restore).toMatch(/pg_restore/iu);
    expect(verify).toContain("verify-objects");
    expect(verify).toContain("ops/scripts/verify-audit.mjs");
    for (const file of ["backup.ps1", "backup.sh", "restore.ps1", "restore.sh"]) {
      const text = await readFile(resolve(root, "ops/scripts", file), "utf8");
      expect(text).not.toContain("--no-privileges");
      expect(text).not.toContain("--no-owner");
      expect(text).not.toContain("node_modules/tsx");
    }
  });

  it("runs a real blank-target backup and restore smoke gate from acceptance", async () => {
    const powershell = await readFile(resolve(root, "ops/scripts/acceptance.ps1"), "utf8");
    const posix = await readFile(resolve(root, "ops/scripts/acceptance.sh"), "utf8");
    const powershellSmoke = await readFile(
      resolve(root, "ops/scripts/backup-restore-smoke.ps1"),
      "utf8",
    );
    const posixSmoke = await readFile(resolve(root, "ops/scripts/backup-restore-smoke.sh"), "utf8");
    expect(powershell).toContain("backup-restore-smoke.ps1");
    expect(posix).toContain("backup-restore-smoke.sh");
    for (const smoke of [powershellSmoke, posixSmoke]) {
      expect(smoke).toContain("seed-backup-restore-job.mjs");
      expect(smoke).toContain(
        "run --rm --no-TTY --entrypoint node worker ops/scripts/runtime-reconcile.mjs",
      );
      expect(smoke).toContain("backup-restore-reconciliation.json");
      expect(smoke.match(/up --detach --wait postgres/gu)).toHaveLength(2);
    }
  });
});
