import type { TransactionManager } from "../ports/transaction-manager.js";

const CONFIRMATION_TEXT = "我理解并接受数字遗产发布后不可撤回";

export type ArmOwnerCommand = Readonly<{
  ownerId: string;
  password: string;
  confirmationText: string;
  expectedPackageId?: string;
  expectedShareGenerationId?: string;
  requestId: string;
}>;

export type ArmOwnerResult = Readonly<{
  state: "ARMED";
  acceptedAt: string;
  packageId: string;
  shareGenerationId: string;
}>;

export class ArmOwnerError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly status = 422,
  ) {
    super(message);
    this.name = "ArmOwnerError";
  }
}

export async function armOwner(
  command: ArmOwnerCommand,
  dependencies: Readonly<{
    transaction: TransactionManager;
    passwordVerifier(password: string, hash: string): Promise<boolean>;
    idFactory?: () => string;
  }>,
): Promise<ArmOwnerResult> {
  if (command.confirmationText !== CONFIRMATION_TEXT) {
    throw new ArmOwnerError("DLS-ARM-CONFIRMATION", "irreversible confirmation text is invalid");
  }
  return dependencies.transaction.run(
    async (tx) => {
      const owner = await tx.repositories.ownerProfile.findById(true, { forUpdate: true });
      const credentials = await tx.repositories.ownerCredentials.findById(true, {
        forUpdate: true,
      });
      if (owner === null || credentials === null || typeof credentials.password_phc !== "string") {
        throw new ArmOwnerError("DLS-ARM-OWNER", "owner setup is incomplete", 409);
      }
      if (!(await dependencies.passwordVerifier(command.password, credentials.password_phc))) {
        throw new ArmOwnerError("DLS-ARM-REAUTH", "owner password reauthentication failed", 401);
      }
      const contacts = (await tx.repositories.contacts.findMany?.()) ?? [];
      if (contacts.filter((row) => row.status === "ACTIVE").length < 3) {
        throw new ArmOwnerError("DLS-ARM-CONTACTS", "at least three active contacts are required");
      }
      const vault = await tx.repositories.vaults.findFirst?.({ forUpdate: true });
      const generationId =
        typeof vault?.active_share_generation_id === "string"
          ? vault.active_share_generation_id
          : undefined;
      if (
        generationId === undefined ||
        (command.expectedShareGenerationId !== undefined &&
          command.expectedShareGenerationId !== generationId)
      ) {
        throw new ArmOwnerError("DLS-ARM-SHARES", "active share generation is unavailable", 409);
      }
      const generation = await tx.repositories.shareGenerations?.findById(generationId, {
        forUpdate: true,
      });
      if (generation === null || generation === undefined || generation.status !== "ACTIVE") {
        throw new ArmOwnerError("DLS-ARM-SHARES", "active share generation is unavailable", 409);
      }
      const packageRows =
        (await tx.repositories.packages.findMany?.("vault_id", String(vault?.id))) ?? [];
      const activePackage = packageRows.find((row) => row.status === "ACTIVE");
      if (
        activePackage === undefined ||
        (command.expectedPackageId !== undefined &&
          String(activePackage.id) !== command.expectedPackageId)
      ) {
        throw new ArmOwnerError("DLS-ARM-PACKAGE", "an active encrypted package is required", 409);
      }
      const settings = await tx.repositories.systemSettings.findById(true, { forUpdate: true });
      if (settings?.smtp_test_status !== "SUCCESS" || typeof settings.smtp_tested_at !== "string") {
        throw new ArmOwnerError("DLS-ARM-SMTP", "SMTP test must succeed before arming");
      }
      const now = await tx.clock.now();
      await tx.repositories.ownerProfile.updateVersioned(true, Number(owner.version ?? 0), {
        setup_state: "ARMED",
        irreversibility_accepted_at: now,
      });
      await tx.audit.append({
        eventId: dependencies.idFactory?.() ?? crypto.randomUUID(),
        occurredAt: now,
        eventType: "OWNER_ARMED",
        actorType: "OWNER",
        aggregateType: "owner",
        aggregateId: command.ownerId,
        requestId: command.requestId,
        result: "SUCCESS",
        metadata: { packageId: String(activePackage.id), shareGenerationId: generationId },
      });
      return {
        state: "ARMED",
        acceptedAt: now,
        packageId: String(activePackage.id),
        shareGenerationId: generationId,
      };
    },
    { isolation: "serializable" },
  );
}

export { CONFIRMATION_TEXT as OWNER_ARM_CONFIRMATION_TEXT };
