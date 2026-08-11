import type { ObjectNamespace, ObjectStoragePort } from "@dls/application";
import type { Pool } from "pg";

type ReferenceRow = Readonly<{
  id: unknown;
  status?: unknown;
  object_key: unknown;
  bytes: unknown;
  sha256: unknown;
}>;

function reference(row: ReferenceRow): Readonly<{ key: string; bytes: number; sha256: string }> {
  const key = String(row.object_key);
  const bytes = Number(row.bytes);
  const sha256 = String(row.sha256);
  if (
    key.length === 0 ||
    !Number.isSafeInteger(bytes) ||
    bytes < 0 ||
    !/^[0-9a-f]{64}$/u.test(sha256)
  ) {
    throw new Error(`database storage reference is invalid: ${String(row.id)}`);
  }
  return { key, bytes, sha256 };
}

async function verify(
  storage: Pick<ObjectStoragePort, "head">,
  namespace: ObjectNamespace,
  row: ReferenceRow,
): Promise<void> {
  const expected = reference(row);
  const actual = await storage.head(namespace, expected.key);
  if (actual === null || actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256) {
    throw new Error(
      `referenced storage object is missing or inconsistent: ${namespace}/${expected.key}`,
    );
  }
}

export async function reconcileStorageReferences(
  database: Pick<Pool, "query">,
  storage: Pick<ObjectStoragePort, "head">,
): Promise<Readonly<{ packages: number; publications: number }>> {
  const packages = await database.query(
    `SELECT id, status::text, object_key, ciphertext_size::text AS bytes,
            encode(ciphertext_sha256, 'hex') AS sha256
     FROM app.legacy_packages
     WHERE status IN ('UPLOADING', 'VALIDATING', 'READY', 'ACTIVE', 'SUPERSEDED', 'DELETE_PENDING')
     ORDER BY id`,
  );
  const publications = await database.query(
    `SELECT id, public_object_key AS object_key, zip_size::text AS bytes,
            encode(zip_sha256, 'hex') AS sha256
     FROM app.publications ORDER BY id`,
  );

  for (const row of packages.rows as ReferenceRow[]) {
    const status = String(row.status);
    const namespace: ObjectNamespace = ["UPLOADING", "VALIDATING", "READY"].includes(status)
      ? "staging"
      : "private";
    await verify(storage, namespace, row);
  }
  for (const row of publications.rows as ReferenceRow[]) await verify(storage, "public", row);
  return { packages: packages.rows.length, publications: publications.rows.length };
}
