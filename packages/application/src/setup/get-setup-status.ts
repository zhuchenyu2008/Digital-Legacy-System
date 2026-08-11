import type { TransactionManager } from "../ports/transaction-manager.js";

export type SetupStatus = Readonly<{
  initialized: boolean;
  steps: Readonly<{
    owner: boolean;
    contacts: boolean;
    package: boolean;
    smtpTest: boolean;
    riskAccepted: boolean;
  }>;
}>;

export async function getSetupStatus(transaction: TransactionManager): Promise<SetupStatus> {
  return transaction.run(async (tx) => {
    const [ownerProfile, contacts, vault, settings] = await Promise.all([
      tx.repositories.ownerProfile.findById(true),
      tx.repositories.contacts.findMany?.(),
      tx.repositories.vaults.findFirst?.(),
      tx.repositories.systemSettings.findById(true),
    ]);
    const owner = ownerProfile !== null;
    const activeContacts = (contacts ?? []).filter((row) => row.status === "ACTIVE");
    const generationId =
      typeof vault?.active_share_generation_id === "string"
        ? vault.active_share_generation_id
        : undefined;
    const generation =
      generationId === undefined
        ? null
        : await tx.repositories.shareGenerations?.findById(generationId);
    const contactsReady = activeContacts.length >= 3 && generation?.status === "ACTIVE";
    const packages =
      vault?.id === undefined
        ? []
        : ((await tx.repositories.packages.findMany?.("vault_id", String(vault.id))) ?? []);
    const activePackage = packages.find((row) => row.status === "ACTIVE");
    const packageReady =
      activePackage !== undefined &&
      (generationId === undefined || String(activePackage.share_generation_id) === generationId);
    const smtpTest =
      settings?.smtp_test_status === "SUCCESS" && typeof settings.smtp_tested_at === "string";
    const riskAccepted = typeof ownerProfile?.irreversibility_accepted_at === "string";
    return {
      initialized: owner,
      steps: {
        owner,
        contacts: contactsReady,
        package: packageReady,
        smtpTest,
        riskAccepted,
      },
    };
  });
}
