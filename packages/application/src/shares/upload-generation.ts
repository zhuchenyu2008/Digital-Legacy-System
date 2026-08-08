import type { TransactionManager } from "../ports/transaction-manager.js";
import {
  activeContactRows,
  bytes,
  contactsFromRows,
  equalBytes,
  generationProof as expectedGenerationProof,
  getNowAndId,
  hex,
  ShareGenerationError,
  shareRepository,
  snapshotDigest,
  type UploadedShare,
} from "./share-generation-common.js";

export type UploadShareGenerationCommand = Readonly<{
  ownerId: string;
  generationId: string;
  contactSetVersion: number;
  contactsSnapshotSha256: Uint8Array;
  protocolVersion: number;
  vssScheme: string;
  generationCommitment: Uint8Array;
  vkCommitment: Uint8Array;
  generationProof: Uint8Array;
  shares: readonly UploadedShare[];
  requestId: string;
}>;

export type UploadShareGenerationResult = Readonly<{
  generationId: string;
  status: "PREPARING";
  contactCount: number;
  deathThreshold: number;
  recoveryThreshold: number;
  generationCommitment: string;
  vkCommitment: string;
  uploadedShareCount: number;
}>;

export async function uploadShareGeneration(
  command: UploadShareGenerationCommand,
  dependencies: Readonly<{ transaction: TransactionManager; idFactory?: () => string }>,
): Promise<UploadShareGenerationResult> {
  const idFactory = dependencies.idFactory ?? (() => crypto.randomUUID());
  return dependencies.transaction.run(
    async (tx) => {
      const generations = shareRepository(tx.repositories.shareGenerations, "share generations");
      const keyShares = shareRepository(tx.repositories.contactKeyShares, "contact key shares");
      const generation = await generations.findById(command.generationId, { forUpdate: true });
      if (generation === null || generation.status !== "PREPARING") {
        throw new ShareGenerationError(
          "DLS-SHARE-GENERATION-MISMATCH",
          "generation is not uploadable",
          409,
        );
      }
      const vault = await tx.repositories.vaults.findById(String(generation.vault_id), {
        forUpdate: true,
      });
      if (
        vault === null ||
        !equalBytes(
          bytes(vault.vk_commitment, "VK commitment", 32, 32),
          bytes(command.vkCommitment, "VK commitment", 32, 32),
        )
      ) {
        throw new ShareGenerationError(
          "DLS-SHARE-INVALID",
          "VK commitment does not match the vault",
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
      if (
        command.protocolVersion !== 1 ||
        command.vssScheme !== "AUDITED_PUBLICLY_VERIFIABLE_SHARING_V1"
      ) {
        throw new ShareGenerationError("DLS-SHARE-INVALID", "unsupported share protocol");
      }
      const rows = (await tx.repositories.contacts.findMany?.()) ?? [];
      const contacts = contactsFromRows(activeContactRows(rows));
      const snapshot = snapshotDigest(contacts);
      if (
        !equalBytes(snapshot, bytes(command.contactsSnapshotSha256, "contacts snapshot", 32, 32)) ||
        !equalBytes(
          snapshot,
          bytes(generation.contacts_snapshot_sha256, "stored contacts snapshot", 32, 32),
        )
      ) {
        throw new ShareGenerationError(
          "DLS-SHARE-GENERATION-MISMATCH",
          "contact roster snapshot is stale",
          409,
        );
      }
      const generationCommitment = bytes(command.generationCommitment, "generation commitment", 32);
      const proof = bytes(command.generationProof, "generation proof", 32, 32);
      if (generationCommitment.every((value) => value === 0)) {
        throw new ShareGenerationError("DLS-SHARE-INVALID", "generation commitment is empty");
      }
      const expectedProof = expectedGenerationProof({
        vaultId: String(generation.vault_id),
        generationId: command.generationId,
        contactsSnapshotSha256: snapshot,
        generationCommitment,
        vkCommitment: bytes(command.vkCommitment, "VK commitment", 32, 32),
      });
      if (!equalBytes(proof, expectedProof)) {
        throw new ShareGenerationError("DLS-SHARE-INVALID", "generation proof is invalid");
      }
      const contactIds = new Set(contacts.map((contact) => contact.contactId));
      if (
        command.shares.length !== contacts.length ||
        new Set(command.shares.map((share) => share.contactId)).size !== contacts.length
      ) {
        throw new ShareGenerationError(
          "DLS-SHARE-INVALID",
          "one unique share is required per contact",
        );
      }
      const sortedShares = [...command.shares].sort(
        (left, right) => left.shareIndex - right.shareIndex,
      );
      for (let index = 0; index < sortedShares.length; index += 1) {
        const share = sortedShares[index];
        if (
          share === undefined ||
          share.shareIndex !== index + 1 ||
          !contactIds.has(share.contactId)
        ) {
          throw new ShareGenerationError(
            "DLS-SHARE-INVALID",
            "share indexes or contacts are invalid",
          );
        }
        bytes(share.deathShareCiphertext, "death share ciphertext", 48);
        bytes(share.recoveryShareCiphertext, "recovery share ciphertext", 48);
        bytes(share.deathShareCommitment, "death share commitment", 32);
        bytes(share.recoveryShareCommitment, "recovery share commitment", 32);
      }
      const existing =
        (await keyShares.findMany?.("generation_id", command.generationId, { forUpdate: true })) ??
        [];
      for (const share of sortedShares) {
        const current = existing.find((row) => row.contact_id === share.contactId);
        const input = {
          generation_id: command.generationId,
          contact_id: share.contactId,
          share_index: share.shareIndex,
          death_share_ciphertext: Buffer.from(share.deathShareCiphertext),
          recovery_share_ciphertext: Buffer.from(share.recoveryShareCiphertext),
          share_protocol_version: 1,
          death_share_commitment: Buffer.from(share.deathShareCommitment),
          recovery_share_commitment: Buffer.from(share.recoveryShareCommitment),
        };
        if (current !== undefined) {
          const same =
            Number(current.share_index) === share.shareIndex &&
            equalBytes(
              bytes(current.death_share_ciphertext, "stored death share"),
              share.deathShareCiphertext,
            ) &&
            equalBytes(
              bytes(current.recovery_share_ciphertext, "stored recovery share"),
              share.recoveryShareCiphertext,
            ) &&
            equalBytes(
              bytes(current.death_share_commitment, "stored death commitment"),
              share.deathShareCommitment,
            ) &&
            equalBytes(
              bytes(current.recovery_share_commitment, "stored recovery commitment"),
              share.recoveryShareCommitment,
            );
          if (!same)
            throw new ShareGenerationError(
              "DLS-SHARE-INVALID",
              "retry payload does not match the stored share",
              409,
            );
          continue;
        }
        await keyShares.insert({ id: idFactory(), ...input });
      }
      if (typeof generations.updateById !== "function") {
        throw new ShareGenerationError(
          "DLS-SHARE-UNAVAILABLE",
          "generation repository cannot be updated",
          503,
        );
      }
      await generations.updateById(command.generationId, {
        generation_commitment: Buffer.from(generationCommitment),
      });
      const nowAndId = await getNowAndId(tx, idFactory);
      await tx.audit.append({
        eventId: nowAndId.id,
        occurredAt: nowAndId.now,
        eventType: "SHARE_GENERATION_UPLOADED",
        actorType: "OWNER",
        aggregateType: "share_generation",
        aggregateId: command.generationId,
        requestId: command.requestId,
        result: "SUCCESS",
        metadata: { uploadedShareCount: sortedShares.length },
      });
      await tx.outbox.enqueue({
        eventType: "SHARE_GENERATION_UPLOADED",
        aggregateType: "share_generation",
        aggregateId: command.generationId,
        payload: { uploadedShareCount: sortedShares.length },
        idempotencyKey: `share-generation-uploaded:${command.generationId}`,
        availableAt: nowAndId.now,
      });
      return {
        generationId: command.generationId,
        status: "PREPARING",
        contactCount: contacts.length,
        deathThreshold: Number(generation.death_threshold),
        recoveryThreshold: Number(generation.recovery_threshold),
        generationCommitment: hex(generationCommitment),
        vkCommitment: hex(bytes(command.vkCommitment, "VK commitment", 32, 32)),
        uploadedShareCount: sortedShares.length,
      };
    },
    { isolation: "serializable" },
  );
}
