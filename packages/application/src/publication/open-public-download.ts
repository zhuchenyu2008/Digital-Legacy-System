import type { ByteRange, ObjectStoragePort } from "../ports/object-storage.js";
import type { TransactionManager } from "../ports/transaction-manager.js";

export async function openPublicDownload(
  request: Readonly<{ range?: ByteRange }>,
  dependencies: Readonly<{ transaction: TransactionManager; storage: ObjectStoragePort }>,
): Promise<
  Readonly<{
    body: AsyncIterable<Uint8Array>;
    bytes: number;
    totalBytes: number;
    etag: string;
    sha256: string;
  }>
> {
  const publication = await dependencies.transaction.run(async (tx) => {
    if (tx.repositories.publications?.findFirst === undefined) {
      throw new Error("publications repository is unavailable");
    }
    const publication = await tx.repositories.publications.findFirst();
    if (publication === null) return null;
    const workflow = await tx.repositories.workflows.findById(String(publication.workflow_id));
    return workflow?.state === "RELEASED" ? publication : null;
  });
  if (publication === null) throw new Error("publication was not found");
  const totalBytes = Number(publication.zip_size);
  const range = request.range;
  if (
    !Number.isSafeInteger(totalBytes) ||
    totalBytes < 0 ||
    (range !== undefined &&
      (!Number.isSafeInteger(range.start) ||
        range.start < 0 ||
        range.start >= totalBytes ||
        (range.endInclusive !== undefined &&
          (!Number.isSafeInteger(range.endInclusive) ||
            range.endInclusive < range.start ||
            range.endInclusive >= totalBytes))))
  ) {
    throw new RangeError("public download byte range is invalid");
  }
  const opened = await dependencies.storage.read(
    "public",
    String(publication.public_object_key),
    range,
  );
  const digest = publication.zip_sha256;
  if (!(digest instanceof Uint8Array) || digest.length !== 32 || opened.totalBytes !== totalBytes) {
    throw new Error("public object metadata does not match the committed publication");
  }
  return { ...opened, sha256: Buffer.from(digest).toString("hex") };
}
