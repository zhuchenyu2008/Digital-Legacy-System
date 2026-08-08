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
    const owner = (await tx.repositories.ownerProfile.findById(true)) !== null;
    return {
      initialized: owner,
      steps: {
        owner,
        contacts: false,
        package: false,
        smtpTest: false,
        riskAccepted: false,
      },
    };
  });
}
