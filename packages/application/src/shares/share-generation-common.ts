import { createHash } from "node:crypto";
import type { RepositoryRow, VersionedRepository } from "../ports/repositories.js";
import type { TransactionContext } from "../ports/transaction-manager.js";

export type ShareGenerationContact = Readonly<{
  contactId: string;
  publicKey: Uint8Array;
}>;

export type UploadedShare = Readonly<{
  contactId: string;
  shareIndex: number;
  deathShareCiphertext: Uint8Array;
  recoveryShareCiphertext: Uint8Array;
  deathShareCommitment: Uint8Array;
  recoveryShareCommitment: Uint8Array;
}>;

export class ShareGenerationError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly status = 422,
  ) {
    super(message);
    this.name = "ShareGenerationError";
  }
}

export function shareRepository(
  value: VersionedRepository | undefined,
  name: string,
): VersionedRepository {
  if (value === undefined) {
    throw new ShareGenerationError("DLS-SHARE-UNAVAILABLE", `${name} is unavailable`, 503);
  }
  return value;
}

export function bytes(value: unknown, field: string, minimum = 1, exact?: number): Uint8Array {
  if (
    !(value instanceof Uint8Array) ||
    value.length < minimum ||
    (exact !== undefined && value.length !== exact)
  ) {
    throw new ShareGenerationError("DLS-SHARE-INVALID", `${field} has an invalid length`);
  }
  return new Uint8Array(value);
}

export function base64url(value: Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

export function hex(value: Uint8Array): string {
  return Buffer.from(value).toString("hex");
}

export function sha256(value: string | Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(value).digest());
}

export function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

export function activeContactRows(rows: readonly RepositoryRow[]): readonly RepositoryRow[] {
  return rows
    .filter((row) => row.status === "ACTIVE" || row.status === "PENDING_KEYING")
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));
}

export function contactsFromRows(
  rows: readonly RepositoryRow[],
): readonly ShareGenerationContact[] {
  return rows.map((row) => ({
    contactId: String(row.id),
    publicKey: bytes(row.x25519_public_key, "contact public key", 32, 32),
  }));
}

export function snapshotDigest(contacts: readonly ShareGenerationContact[]): Uint8Array {
  const canonical = JSON.stringify(
    contacts.map((contact) => ({
      contactId: contact.contactId,
      publicKey: base64url(contact.publicKey),
    })),
  );
  return sha256(canonical);
}

export function thresholds(contactCount: number): Readonly<{ death: number; recovery: number }> {
  return {
    death: Math.ceil(contactCount * 0.7),
    recovery: Math.floor(contactCount / 2) + 1,
  };
}

export function generationProof(
  input: Readonly<{
    vaultId: string;
    generationId: string;
    contactsSnapshotSha256: Uint8Array;
    generationCommitment: Uint8Array;
    vkCommitment: Uint8Array;
  }>,
): Uint8Array {
  return sha256(
    JSON.stringify({
      context: "DLS/SHARE-GENERATION-PROOF/V1",
      contactsSnapshotSha256: base64url(input.contactsSnapshotSha256),
      generationCommitment: base64url(input.generationCommitment),
      generationId: input.generationId,
      vaultId: input.vaultId,
      vkCommitment: base64url(input.vkCommitment),
    }),
  );
}

export function getNowAndId(
  tx: TransactionContext,
  idFactory: () => string,
): Promise<Readonly<{ now: string; id: string }>> {
  return tx.clock.now().then((now) => ({ now, id: idFactory() }));
}

export function contactView(contact: ShareGenerationContact) {
  return { contactId: contact.contactId, publicKey: base64url(contact.publicKey) };
}
