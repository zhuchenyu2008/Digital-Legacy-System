import type { TransactionManager } from "../ports/transaction-manager.js";
import {
  activeContactRows,
  contactsFromRows,
  contactView,
  hex,
  ShareGenerationError,
  shareRepository,
  snapshotDigest,
} from "./share-generation-common.js";

export async function getShareGenerationMaterial(
  generationId: string,
  transaction: TransactionManager,
) {
  return transaction.run(async (tx) => {
    const generation = await shareRepository(
      tx.repositories.shareGenerations,
      "share generations",
    ).findById(generationId);
    if (generation === null)
      throw new ShareGenerationError(
        "DLS-SHARE-GENERATION-MISMATCH",
        "generation is unavailable",
        404,
      );
    const contacts = contactsFromRows(
      activeContactRows((await tx.repositories.contacts.findMany?.()) ?? []),
    );
    return {
      generationId,
      vaultId: String(generation.vault_id),
      status: generation.status,
      contactSetVersion: Number(
        (await tx.repositories.systemSettings.findById(true))?.contact_set_version ?? 0,
      ),
      contactsSnapshotSha256: hex(snapshotDigest(contacts)),
      contacts: contacts.map(contactView),
      deathThreshold: Number(generation.death_threshold),
      recoveryThreshold: Number(generation.recovery_threshold),
      protocolVersion: Number(generation.protocol_version),
      vssScheme: String(generation.vss_scheme),
    };
  });
}
