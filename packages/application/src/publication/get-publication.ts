import type { TransactionManager } from "../ports/transaction-manager.js";

export type PublicPublication = Readonly<{
  ownerDisplayName: string;
  publishedAt: string;
  willHtml: string;
  package: Readonly<{ downloadPath: string; size: number; sha256: string }>;
  auditFinalHash: string;
}>;

function hex(value: unknown, label: string): string {
  if (!(value instanceof Uint8Array) || value.length !== 32) throw new Error(`${label} is invalid`);
  return Buffer.from(value).toString("hex");
}

export async function getPublication(
  transaction: TransactionManager,
): Promise<PublicPublication | null> {
  return transaction.run(async (tx) => {
    const publications = tx.repositories.publications;
    if (publications?.findFirst === undefined)
      throw new Error("publications repository is unavailable");
    const row = await publications.findFirst();
    if (row === null) return null;
    const workflow = await tx.repositories.workflows.findById(String(row.workflow_id));
    if (workflow === null || workflow.state !== "RELEASED") return null;
    return {
      ownerDisplayName: String(row.owner_display_name),
      publishedAt: String(row.published_at),
      willHtml: String(row.will_html_sanitized),
      package: {
        downloadPath: "/public/legacy/package",
        size: Number(row.zip_size),
        sha256: hex(row.zip_sha256, "publication ZIP digest"),
      },
      auditFinalHash: hex(row.public_audit_final_hash, "public audit final hash"),
    };
  });
}

export async function getPublicationAudit(transaction: TransactionManager): Promise<
  | readonly Readonly<{
      sequence: number;
      occurredAt: string;
      code: string;
      message: string;
      metadata: unknown;
      previousHash: string;
      eventHash: string;
    }>[]
  | null
> {
  return transaction.run(async (tx) => {
    const publications = tx.repositories.publications;
    const publicEvents = tx.repositories.publicEvents;
    if (publications?.findFirst === undefined || publicEvents?.findMany === undefined) {
      throw new Error("public publication repositories are unavailable");
    }
    const publication = await publications.findFirst();
    if (publication === null) return null;
    const rows = await publicEvents.findMany("publication_id", publication.id);
    return [...rows]
      .sort((left, right) => Number(left.sequence_no) - Number(right.sequence_no))
      .map((row) => ({
        sequence: Number(row.sequence_no),
        occurredAt: String(row.occurred_at),
        code: String(row.event_code),
        message: String(row.public_message),
        metadata: row.public_metadata,
        previousHash: hex(row.previous_hash, "public audit previous hash"),
        eventHash: hex(row.event_hash, "public audit event hash"),
      }));
  });
}
