import type {
  CreateNotificationCommand,
  RepositoryRow,
  TransactionManager,
} from "@dls/application";

type ProtectedField = Readonly<{
  ciphertext: Uint8Array;
  nonce: Uint8Array;
  keyVersion: number;
}>;

type Dependencies = Readonly<{
  transaction: TransactionManager;
  publicBaseUrl: string;
  unprotect(value: ProtectedField, purpose: string): Promise<string>;
  enqueue(command: CreateNotificationCommand): Promise<void>;
}>;

function bytes(value: unknown, field: string): Uint8Array {
  if (!(value instanceof Uint8Array)) throw new Error(`${field} is unavailable`);
  return new Uint8Array(value);
}

function integer(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${field} is unavailable`);
  return parsed;
}

function protectedField(row: RepositoryRow, prefix: string): ProtectedField {
  return {
    ciphertext: bytes(row[`${prefix}_ciphertext`], `${prefix} ciphertext`),
    nonce: bytes(row[`${prefix}_nonce`], `${prefix} nonce`),
    keyVersion: integer(row[`${prefix}_key_version`], `${prefix} key version`),
  };
}

export class RecoveryNotifications {
  public constructor(private readonly dependencies: Dependencies) {}

  public async ownerStart(
    challenge: Readonly<{ challengeId: string; token: string; expiresAt: string }>,
  ): Promise<void> {
    const owner = await this.owner();
    const actionUrl = new URL("/password-recovery", this.dependencies.publicBaseUrl);
    actionUrl.hash = new URLSearchParams({ recovery: challenge.token }).toString();
    await this.dependencies.enqueue({
      eventId: crypto.randomUUID(),
      aggregateId: "00000000-0000-0000-0000-000000000001",
      aggregateType: "owner",
      templateCode: "OWNER_RECOVERY_START",
      templateContext: { expires_at: challenge.expiresAt, action_url: actionUrl.href },
      recipient: { type: "OWNER_PRIMARY", email: owner.primaryEmail },
      idempotencyKey: `owner-recovery-start:${challenge.challengeId}`,
    });
  }

  public async contacts(input: Readonly<{ workflowId: string; expiresAt: string }>): Promise<void> {
    const owner = await this.owner();
    const snapshots = await this.dependencies.transaction.run(async (tx) =>
      tx.repositories.workflowContacts?.findMany?.("workflow_id", input.workflowId),
    );
    if (snapshots === undefined || snapshots.length === 0) {
      throw new Error("recovery workflow contacts are unavailable");
    }
    for (const snapshot of snapshots) {
      const contactId = String(snapshot.contact_id);
      const email = await this.dependencies.unprotect(
        protectedField(snapshot, "email_snapshot"),
        "contact-email",
      );
      const actionUrl = new URL("/contact/login", this.dependencies.publicBaseUrl);
      actionUrl.hash = new URLSearchParams({ entry: input.workflowId }).toString();
      await this.dependencies.enqueue({
        eventId: crypto.randomUUID(),
        aggregateId: input.workflowId,
        aggregateType: "workflow",
        templateCode: "OWNER_RECOVERY_CONTACT_REQUEST",
        templateContext: {
          owner_name: owner.displayName,
          expires_at: input.expiresAt,
          action_url: actionUrl.href,
        },
        recipient: { type: "CONTACT", email, ref: contactId },
        idempotencyKey: `owner-recovery-contact:${input.workflowId}:${contactId}`,
      });
    }
  }

  public async ownerReset(
    challenge: Readonly<{
      workflowId: string;
      token: string;
      code: string;
      expiresAt: string;
    }>,
  ): Promise<void> {
    const owner = await this.owner();
    const actionUrl = new URL("/password-recovery", this.dependencies.publicBaseUrl);
    actionUrl.hash = new URLSearchParams({
      recovery: challenge.token,
      code: challenge.code,
    }).toString();
    await this.dependencies.enqueue({
      eventId: crypto.randomUUID(),
      aggregateId: challenge.workflowId,
      aggregateType: "workflow",
      templateCode: "OWNER_PASSWORD_RESET",
      templateContext: { expires_at: challenge.expiresAt, action_url: actionUrl.href },
      recipient: { type: "OWNER_PRIMARY", email: owner.primaryEmail },
      idempotencyKey: `owner-password-reset:${challenge.workflowId}`,
    });
  }

  private async owner(): Promise<Readonly<{ displayName: string; primaryEmail: string }>> {
    const owner = await this.dependencies.transaction.run((tx) =>
      tx.repositories.ownerProfile.findById(true),
    );
    if (owner === null) throw new Error("owner profile is unavailable");
    const [displayName, primaryEmail] = await Promise.all([
      this.dependencies.unprotect(protectedField(owner, "display_name"), "owner-display-name"),
      this.dependencies.unprotect(protectedField(owner, "primary_email"), "owner-primary-email"),
    ]);
    return { displayName, primaryEmail };
  }
}
