import type { TransactionManager } from "../ports/transaction-manager.js";
import {
  activeContactRows,
  contactsFromRows,
  contactView,
  getNowAndId,
  hex,
  ShareGenerationError,
  shareRepository,
  snapshotDigest,
  thresholds,
} from "./share-generation-common.js";

export type CreateShareGenerationCommand = Readonly<{
  ownerId: string;
  vaultId: string;
  contactSetVersion: number;
  expectedCurrentGenerationId?: string;
  requestId: string;
}>;

export type CreateShareGenerationResult = Readonly<{
  generationId: string;
  generationNo: number;
  status: "PREPARING";
  contactCount: number;
  deathThreshold: number;
  recoveryThreshold: number;
  contactsSnapshotSha256: string;
  protocolVersion: 1;
  vssScheme: "AUDITED_PUBLICLY_VERIFIABLE_SHARING_V1";
  contacts: readonly Readonly<{ contactId: string; publicKey: string }>[];
}>;

export async function createShareGeneration(
  command: CreateShareGenerationCommand,
  dependencies: Readonly<{
    transaction: TransactionManager;
    idFactory?: () => string;
  }>,
): Promise<CreateShareGenerationResult> {
  const idFactory = dependencies.idFactory ?? (() => crypto.randomUUID());
  return dependencies.transaction.run(
    async (tx) => {
      const generations = shareRepository(tx.repositories.shareGenerations, "share generations");
      const vault = await tx.repositories.vaults.findById(command.vaultId, { forUpdate: true });
      if (vault === null)
        throw new ShareGenerationError(
          "DLS-SHARE-GENERATION-MISMATCH",
          "vault is unavailable",
          404,
        );
      if (
        command.expectedCurrentGenerationId !== undefined &&
        String(vault.active_share_generation_id ?? "") !== command.expectedCurrentGenerationId
      ) {
        throw new ShareGenerationError(
          "DLS-SHARE-GENERATION-MISMATCH",
          "current generation is stale",
          409,
        );
      }
      const settings = await tx.repositories.systemSettings.findById(true, { forUpdate: true });
      if (
        settings === null ||
        Number(settings.contact_set_version ?? -1) !== command.contactSetVersion
      ) {
        throw new ShareGenerationError(
          "DLS-SHARE-GENERATION-MISMATCH",
          "contact roster is stale",
          409,
        );
      }
      const rows = (await tx.repositories.contacts.findMany?.()) ?? [];
      const contacts = contactsFromRows(activeContactRows(rows));
      if (contacts.length < 3) {
        throw new ShareGenerationError(
          "DLS-CONTACT-MINIMUM",
          "at least three active contacts are required",
          422,
        );
      }
      const existing =
        (await generations.findMany?.("vault_id", command.vaultId, { forUpdate: true })) ?? [];
      const generationNo =
        Math.max(0, ...existing.map((row) => Number(row.generation_no ?? 0))) + 1;
      const generationId = idFactory();
      const snapshot = snapshotDigest(contacts);
      const nowAndId = await getNowAndId(tx, idFactory);
      const policy = thresholds(contacts.length);
      await generations.insert({
        id: generationId,
        vault_id: command.vaultId,
        generation_no: generationNo,
        contact_count: contacts.length,
        death_threshold: policy.death,
        recovery_threshold: policy.recovery,
        contacts_snapshot_sha256: Buffer.from(snapshot),
        protocol_version: 1,
        vss_scheme: "AUDITED_PUBLICLY_VERIFIABLE_SHARING_V1",
        generation_commitment: Buffer.alloc(32),
        status: "PREPARING",
      });
      await tx.audit.append({
        eventId: nowAndId.id,
        occurredAt: nowAndId.now,
        eventType: "SHARE_GENERATION_CREATED",
        actorType: "OWNER",
        aggregateType: "share_generation",
        aggregateId: generationId,
        requestId: command.requestId,
        result: "SUCCESS",
        metadata: { vaultId: command.vaultId, generationNo, contactCount: contacts.length },
      });
      await tx.outbox.enqueue({
        eventType: "SHARE_GENERATION_CREATED",
        aggregateType: "share_generation",
        aggregateId: generationId,
        payload: { vaultId: command.vaultId, generationNo },
        idempotencyKey: `share-generation-created:${generationId}`,
        availableAt: nowAndId.now,
      });
      return {
        generationId,
        generationNo,
        status: "PREPARING",
        contactCount: contacts.length,
        deathThreshold: policy.death,
        recoveryThreshold: policy.recovery,
        contactsSnapshotSha256: hex(snapshot),
        protocolVersion: 1,
        vssScheme: "AUDITED_PUBLICLY_VERIFIABLE_SHARING_V1",
        contacts: contacts.map(contactView),
      };
    },
    { isolation: "serializable" },
  );
}
