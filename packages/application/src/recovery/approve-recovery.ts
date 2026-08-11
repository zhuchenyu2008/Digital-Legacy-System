import { randomInt } from "node:crypto";
import type { RepositoryRow } from "../ports/repositories.js";
import type {
  FragmentCryptography,
  FragmentEnvelopeContext,
  FragmentVerificationContext,
  StageKeyProvider,
} from "../ports/stage-key-provider.js";
import type { TransactionManager } from "../ports/transaction-manager.js";
import {
  addMinutes,
  digestSecret,
  makeSecret,
  RecoveryError,
  recoveryBytes,
  recoveryInteger,
  recoveryRepository,
  recoverySha256,
  sameBytes,
} from "./recovery-common.js";

export interface RecoveryCryptography {
  openStageShare(
    input: Readonly<{ fragment: RepositoryRow; stageKey: Uint8Array }>,
  ): Promise<Uint8Array>;
  verifyShare(
    input: Readonly<{
      fragment: RepositoryRow;
      share: Uint8Array;
      generation: RepositoryRow;
      vault: RepositoryRow;
    }>,
  ): Promise<boolean>;
  reconstruct(
    input: Readonly<{
      shares: readonly Uint8Array[];
      fragments: readonly RepositoryRow[];
      generation: RepositoryRow;
      vault: RepositoryRow;
    }>,
  ): Promise<Uint8Array>;
  commitVaultKey(vaultKey: Uint8Array): Promise<Uint8Array>;
  wrapRecoveryVaultKey(
    input: Readonly<{
      workflowId: string;
      vaultId: string;
      vaultKey: Uint8Array;
      stageKey: Uint8Array;
      stageKeyVersion: number;
    }>,
  ): Promise<Readonly<{ protocolVersion: 1; nonce: Uint8Array; ciphertext: Uint8Array }>>;
  openRecoveryVaultKey(input: Readonly<{ session: RepositoryRow }>): Promise<Uint8Array>;
  sealVaultKey(
    input: Readonly<{
      workflowId: string;
      vaultKey: Uint8Array;
      clientEphemeralPublicKey: Uint8Array;
    }>,
  ): Promise<Uint8Array>;
}

export type RecoveryFragment = Readonly<{
  generationId: string;
  shareIndex: number;
  commitmentDigest: Uint8Array;
  ingressKeyVersion: number;
  protocolVersion: 1;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
}>;

export type ApproveRecoveryCommand = Readonly<{
  workflowId: string;
  contactId: string;
  password: string;
  requestId: string;
  fragment: RecoveryFragment;
}>;

export type ApproveRecoveryResult = Readonly<{
  approved: true;
  approvedCount: number;
  thresholdReached: boolean;
  workflowState: "AWAITING_APPROVALS" | "REWRAP_PENDING";
}>;

async function keyForVersion(provider: StageKeyProvider, version: number): Promise<Uint8Array> {
  const provided =
    provider.stageKey === undefined
      ? await provider.currentStageKey("RECOVERY")
      : await provider.stageKey("RECOVERY", version);
  if (provided.version !== version) {
    provided.key.fill(0);
    throw new RecoveryError("DLS-RECOVERY-KEY-VERSION", "recovery stage key is unavailable", 503);
  }
  return recoveryBytes(provided.key, "recovery stage key", 32);
}

function exactEightDigitCode(factory?: () => string): string {
  const code = factory?.() ?? String(randomInt(0, 100_000_000)).padStart(8, "0");
  if (!/^\d{8}$/u.test(code)) {
    throw new RecoveryError("DLS-RECOVERY-UNAVAILABLE", "verification code generator failed", 500);
  }
  return code;
}

export async function approveRecovery(
  command: ApproveRecoveryCommand,
  dependencies: Readonly<{
    transaction: TransactionManager;
    passwordVerifier: (password: string, encodedHash: string) => Promise<boolean>;
    stageKeys: StageKeyProvider;
    fragmentCryptography: FragmentCryptography;
    recoveryCryptography: RecoveryCryptography;
    tokenPepper: Uint8Array;
    tokenFactory?: () => Uint8Array;
    codeFactory?: () => string;
    onPrimaryResetChallenge?: (
      challenge: Readonly<{
        workflowId: string;
        token: string;
        code: string;
        expiresAt: string;
      }>,
    ) => Promise<void>;
    idFactory?: () => string;
  }>,
): Promise<ApproveRecoveryResult> {
  let challenge:
    | Readonly<{ workflowId: string; token: string; code: string; expiresAt: string }>
    | undefined;
  const result = await dependencies.transaction.run(async (tx) => {
    const workflow = await tx.repositories.workflows.findById(command.workflowId, {
      forUpdate: true,
    });
    if (
      workflow === null ||
      workflow.kind !== "PASSWORD_RECOVERY" ||
      workflow.state !== "AWAITING_APPROVALS"
    ) {
      throw new RecoveryError("DLS-RECOVERY-CLOSED", "recovery approvals are closed", 409);
    }
    const now = await tx.clock.now();
    if (
      typeof workflow.expires_at !== "string" ||
      Date.parse(now) >= Date.parse(workflow.expires_at)
    ) {
      throw new RecoveryError("DLS-RECOVERY-CLOSED", "recovery workflow has expired", 409);
    }
    const roster =
      (await recoveryRepository(tx.repositories.workflowContacts, "workflow contacts").findMany?.(
        "workflow_id",
        command.workflowId,
        { forUpdate: true },
      )) ?? [];
    const snapshot = roster.find((row) => String(row.contact_id) === command.contactId);
    const contact = await tx.repositories.contacts.findById(command.contactId, { forUpdate: true });
    if (
      snapshot === undefined ||
      contact === null ||
      contact.status !== "ACTIVE" ||
      typeof contact.password_phc !== "string" ||
      !(await dependencies.passwordVerifier(command.password, contact.password_phc))
    ) {
      throw new RecoveryError(
        "DLS-RECOVERY-REAUTH-REQUIRED",
        "recent contact password reauthentication is required",
        401,
      );
    }
    const actions = recoveryRepository(
      tx.repositories.workflowContactActions,
      "workflow contact actions",
    );
    const existingActions =
      (await actions.findMany?.("workflow_id", command.workflowId, { forUpdate: true })) ?? [];
    if (existingActions.some((row) => String(row.contact_id) === command.contactId)) {
      throw new RecoveryError("DLS-RECOVERY-DUPLICATE", "contact already approved recovery", 409);
    }
    const fragment = command.fragment;
    if (
      fragment.protocolVersion !== 1 ||
      fragment.generationId !== String(workflow.share_generation_id) ||
      fragment.shareIndex !== Number(snapshot.share_index)
    ) {
      throw new RecoveryError(
        "DLS-RECOVERY-FRAGMENT-INVALID",
        "recovery fragment is mixed or stale",
        409,
      );
    }
    const generation = await recoveryRepository(
      tx.repositories.shareGenerations,
      "share generations",
    ).findById(fragment.generationId, { forUpdate: true });
    const keyShares =
      (await recoveryRepository(tx.repositories.contactKeyShares, "contact key shares").findMany?.(
        "generation_id",
        fragment.generationId,
        { forUpdate: true },
      )) ?? [];
    const keyShare = keyShares.find(
      (row) =>
        String(row.contact_id) === command.contactId &&
        Number(row.share_index) === fragment.shareIndex,
    );
    if (generation === null || keyShare === undefined) {
      throw new RecoveryError("DLS-RECOVERY-FRAGMENT-INVALID", "recovery fragment is stale", 409);
    }
    const vault = await tx.repositories.vaults.findById(String(generation.vault_id), {
      forUpdate: true,
    });
    if (vault === null) {
      throw new RecoveryError("DLS-RECOVERY-UNAVAILABLE", "vault is unavailable", 503);
    }
    const commitment = recoveryBytes(
      keyShare.recovery_share_commitment,
      "recovery share commitment",
    );
    const commitmentDigest = recoveryBytes(fragment.commitmentDigest, "commitment digest", 32);
    if (!sameBytes(recoverySha256(commitment), commitmentDigest)) {
      throw new RecoveryError(
        "DLS-RECOVERY-FRAGMENT-INVALID",
        "recovery fragment commitment does not match",
        409,
      );
    }
    const envelopeContext: FragmentEnvelopeContext = {
      workflowId: command.workflowId,
      contactId: command.contactId,
      generationId: fragment.generationId,
      shareIndex: fragment.shareIndex,
      purpose: "RECOVERY",
      commitmentDigest,
      ingressKeyVersion: recoveryInteger(fragment.ingressKeyVersion, "ingress key version"),
    };
    const pair = await dependencies.stageKeys.ingressKeyPair(
      "RECOVERY",
      envelopeContext.ingressKeyVersion,
    );
    if (pair.version !== envelopeContext.ingressKeyVersion) {
      throw new RecoveryError(
        "DLS-RECOVERY-KEY-VERSION",
        "recovery ingress key is unavailable",
        503,
      );
    }
    const plaintextShare = await dependencies.fragmentCryptography.openIngress({
      context: envelopeContext,
      envelope: {
        protocolVersion: 1,
        nonce: recoveryBytes(fragment.nonce, "ingress nonce", 24),
        ciphertext: recoveryBytes(fragment.ciphertext, "ingress ciphertext", undefined, 49),
      },
      keyPair: {
        version: pair.version,
        publicKey: recoveryBytes(pair.publicKey, "ingress public key", 32),
        privateKey: recoveryBytes(pair.privateKey, "ingress private key", 32),
      },
    });
    const verification: FragmentVerificationContext = {
      ...envelopeContext,
      vaultId: String(generation.vault_id),
      threshold: recoveryInteger(generation.recovery_threshold, "recovery threshold"),
      shareCount: recoveryInteger(generation.contact_count, "share count"),
      shareCommitment: commitment,
      generationCommitment: recoveryBytes(
        generation.generation_commitment,
        "generation commitment",
      ),
      vkCommitment: recoveryBytes(vault.vk_commitment, "vault key commitment", 32),
    };
    if (
      !(await dependencies.fragmentCryptography.verifyShare({
        context: verification,
        plaintextShare,
      }))
    ) {
      plaintextShare.fill(0);
      throw new RecoveryError(
        "DLS-RECOVERY-FRAGMENT-INVALID",
        "recovery share failed verification",
        422,
      );
    }
    const currentStage = await dependencies.stageKeys.currentStageKey("RECOVERY");
    const stageKey = recoveryBytes(currentStage.key, "recovery stage key", 32);
    const wrappedShare = await dependencies.fragmentCryptography.wrapStage({
      context: envelopeContext,
      plaintextShare,
      stageKey,
      stageKeyVersion: recoveryInteger(currentStage.version, "stage key version"),
    });
    plaintextShare.fill(0);
    stageKey.fill(0);
    const fragmentId = dependencies.idFactory?.() ?? crypto.randomUUID();
    await recoveryRepository(tx.repositories.workflowKeyFragments, "workflow fragments").insert({
      id: fragmentId,
      workflow_id: command.workflowId,
      contact_id: command.contactId,
      purpose: "RECOVERY",
      generation_id: fragment.generationId,
      share_index: fragment.shareIndex,
      fragment_ciphertext: recoveryBytes(wrappedShare.ciphertext, "stage ciphertext"),
      fragment_nonce: recoveryBytes(wrappedShare.nonce, "stage nonce", 24),
      fragment_commitment: commitment,
      fragment_commitment_digest: commitmentDigest,
      decision_digest: recoverySha256(command.requestId),
      status: "VALIDATED",
      ingress_key_version: envelopeContext.ingressKeyVersion,
      stage_key_version: currentStage.version,
      protocol_version: 1,
      created_at: now,
      updated_at: now,
    });
    await actions.insert({
      id: crypto.randomUUID(),
      workflow_id: command.workflowId,
      contact_id: command.contactId,
      decision: "RECOVERY_APPROVE",
      decision_digest: recoverySha256(command.requestId),
      created_at: now,
    });
    const approvedCount = existingActions.length + 1;
    const requiredCount = recoveryInteger(workflow.required_count_snapshot, "required count");
    if (approvedCount < requiredCount) {
      await tx.repositories.workflows.updateVersioned(
        command.workflowId,
        Number(workflow.version ?? 0),
        { approved_count: approvedCount },
      );
      return {
        approved: true,
        approvedCount,
        thresholdReached: false,
        workflowState: "AWAITING_APPROVALS",
      } as const;
    }

    const fragments = recoveryRepository(
      tx.repositories.workflowKeyFragments,
      "workflow fragments",
    );
    const rows =
      (await fragments.findMany?.("workflow_id", command.workflowId, { forUpdate: true })) ?? [];
    const selected = rows
      .filter((row) => row.status === "VALIDATED" && row.purpose === "RECOVERY")
      .sort((left, right) => Number(left.share_index) - Number(right.share_index))
      .slice(0, requiredCount);
    if (selected.length !== requiredCount) {
      throw new RecoveryError(
        "DLS-RECOVERY-FRAGMENT-INVALID",
        "recovery threshold shares are incomplete",
        409,
      );
    }
    const shares: Uint8Array[] = [];
    let vaultKey: Uint8Array | undefined;
    try {
      for (const row of selected) {
        const key = await keyForVersion(
          dependencies.stageKeys,
          recoveryInteger(row.stage_key_version, "stage key version"),
        );
        try {
          const share = await dependencies.recoveryCryptography.openStageShare({
            fragment: row,
            stageKey: key,
          });
          if (
            !(await dependencies.recoveryCryptography.verifyShare({
              fragment: row,
              share,
              generation,
              vault,
            }))
          ) {
            share.fill(0);
            throw new RecoveryError(
              "DLS-RECOVERY-FRAGMENT-INVALID",
              "staged share is invalid",
              422,
            );
          }
          shares.push(share);
        } finally {
          key.fill(0);
        }
      }
      vaultKey = await dependencies.recoveryCryptography.reconstruct({
        shares,
        fragments: selected,
        generation,
        vault,
      });
      const actualCommitment = await dependencies.recoveryCryptography.commitVaultKey(vaultKey);
      const expectedCommitment = recoveryBytes(vault.vk_commitment, "vault key commitment", 32);
      if (!sameBytes(actualCommitment, expectedCommitment)) {
        throw new RecoveryError(
          "DLS-RECOVERY-FRAGMENT-INVALID",
          "vault key commitment mismatch",
          422,
        );
      }
      const recoveryStage = await dependencies.stageKeys.currentStageKey("RECOVERY");
      const recoveryStageKey = recoveryBytes(recoveryStage.key, "recovery stage key", 32);
      try {
        const wrappedVaultKey = await dependencies.recoveryCryptography.wrapRecoveryVaultKey({
          workflowId: command.workflowId,
          vaultId: String(vault.id),
          vaultKey,
          stageKey: recoveryStageKey,
          stageKeyVersion: recoveryStage.version,
        });
        await recoveryRepository(
          tx.repositories.recoverySecretSessions,
          "recovery secret sessions",
        ).insert({
          id: crypto.randomUUID(),
          workflow_id: command.workflowId,
          stage_key_envelope: recoveryBytes(wrappedVaultKey.ciphertext, "stage VK ciphertext"),
          stage_key_nonce: recoveryBytes(wrappedVaultKey.nonce, "stage VK nonce", 24),
          stage_key_protocol_version: 1,
          stage_key_version: recoveryStage.version,
          vault_key_commitment: expectedCommitment,
          status: "ACTIVE",
          expires_at: workflow.expires_at,
          consumed_at: null,
          created_at: now,
          updated_at: now,
        });
      } finally {
        recoveryStageKey.fill(0);
      }
      for (const row of rows) {
        await fragments.updateVersioned(row.id, Number(row.version ?? 0), {
          status: "DESTROYED",
          fragment_ciphertext: null,
          fragment_nonce: null,
          stage_key_version: null,
        });
      }
      await tx.repositories.workflows.updateVersioned(
        command.workflowId,
        Number(workflow.version ?? 0),
        { state: "REWRAP_PENDING", approved_count: approvedCount },
      );
      const token = makeSecret(dependencies.tokenFactory);
      const code = exactEightDigitCode(dependencies.codeFactory);
      const challengeExpiresAt = addMinutes(now, 10);
      challenge = { workflowId: command.workflowId, token, code, expiresAt: challengeExpiresAt };
      await recoveryRepository(tx.repositories.oneTimeTokens, "one-time tokens").insert({
        id: crypto.randomUUID(),
        purpose: "ADMIN_PASSWORD_RESET",
        subject_type: "WORKFLOW",
        subject_id: command.workflowId,
        token_hash: digestSecret(token, dependencies.tokenPepper),
        token_hmac_key_version: 1,
        expires_at: challengeExpiresAt,
        consumed_at: null,
        revoked_at: null,
        created_at: now,
      });
      await recoveryRepository(
        tx.repositories.emailVerificationCodes,
        "email verification codes",
      ).insert({
        id: crypto.randomUUID(),
        purpose: "ADMIN_PASSWORD_RESET_CODE",
        owner_singleton_id: true,
        workflow_id: command.workflowId,
        code_hmac: digestSecret(code, dependencies.tokenPepper),
        token_hmac_key_version: 1,
        notification_id: null,
        expires_at: challengeExpiresAt,
        attempt_count: 0,
        max_attempts: 5,
        consumed_at: null,
        locked_at: null,
        created_at: now,
        updated_at: now,
      });
      return {
        approved: true,
        approvedCount,
        thresholdReached: true,
        workflowState: "REWRAP_PENDING",
      } as const;
    } finally {
      for (const share of shares) share.fill(0);
      vaultKey?.fill(0);
    }
  });
  if (challenge !== undefined) await dependencies.onPrimaryResetChallenge?.(challenge);
  return result;
}
