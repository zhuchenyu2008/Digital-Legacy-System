import type { TransactionManager } from "../ports/transaction-manager.js";
import {
  assertContactCanAct,
  type ContactPasswordVerifier,
  normalizedExact,
  type OwnerDisplayNameReader,
  ownedBytes,
  ownerSnapshot,
  positiveInteger,
  reserveDecision,
  sha256,
} from "./contact-decision-common.js";
import { submitFragmentInTransaction } from "./submit-fragment.js";

export function deathConfirmationText(ownerDisplayName: string): string {
  return `我确认${ownerDisplayName.normalize("NFC")}已经无法联络，且有很大可能已经离世或已确认离世`;
}

export type AffirmDeathCommand = Readonly<{
  workflowId: string;
  contactId: string;
  password: string;
  confirmationText: string;
  fragment: Readonly<{
    generationId: string;
    shareIndex: number;
    commitmentDigest: Uint8Array;
    ingressKeyVersion: number;
    protocolVersion: 1;
    nonce: Uint8Array;
    ciphertext: Uint8Array;
  }>;
  requestId: string;
}>;

export type AffirmDeathResult = Readonly<{
  accepted: true;
  processing: true;
  fragmentId: string;
}>;

export async function affirmDeath(
  command: AffirmDeathCommand,
  dependencies: Readonly<{
    transaction: TransactionManager;
    passwordVerifier: ContactPasswordVerifier;
    ownerDisplayName: OwnerDisplayNameReader;
    idFactory?: () => string;
  }>,
): Promise<AffirmDeathResult> {
  const idFactory = dependencies.idFactory ?? (() => crypto.randomUUID());
  const commitmentDigest = ownedBytes(command.fragment.commitmentDigest, "commitment digest", 32);
  const nonce = ownedBytes(command.fragment.nonce, "fragment nonce", 24);
  const ciphertext = ownedBytes(command.fragment.ciphertext, "fragment ciphertext", undefined, 49);
  positiveInteger(command.fragment.shareIndex, "share index");
  positiveInteger(command.fragment.ingressKeyVersion, "ingress key version");
  try {
    return await dependencies.transaction.run(
      async (tx) => {
        const decisionDigest = sha256(command.confirmationText.normalize("NFC"));
        try {
          const reservation = await reserveDecision<AffirmDeathResult>(tx, {
            contactId: command.contactId,
            commandName: "AFFIRM_DEATH",
            requestId: command.requestId,
            requestIdentity: {
              workflowId: command.workflowId,
              generationId: command.fragment.generationId,
              shareIndex: command.fragment.shareIndex,
              decisionDigest: Buffer.from(decisionDigest).toString("hex"),
              commitmentDigest: Buffer.from(commitmentDigest).toString("hex"),
            },
          });
          if (reservation.replay !== undefined) return reservation.replay;
          const { workflow } = await assertContactCanAct(
            tx,
            command.workflowId,
            command.contactId,
            command.password,
            dependencies.passwordVerifier,
          );
          const ownerName = await dependencies.ownerDisplayName(ownerSnapshot(workflow));
          normalizedExact(command.confirmationText, deathConfirmationText(ownerName));
          const fragment = await submitFragmentInTransaction(
            {
              workflowId: command.workflowId,
              contactId: command.contactId,
              generationId: command.fragment.generationId,
              shareIndex: command.fragment.shareIndex,
              purpose: "DEATH",
              commitmentDigest,
              ingressKeyVersion: command.fragment.ingressKeyVersion,
              protocolVersion: command.fragment.protocolVersion,
              nonce,
              ciphertext,
              requestId: command.requestId,
              decisionDigest,
            },
            { tx, idFactory },
          );
          const response: AffirmDeathResult = {
            accepted: true,
            processing: true,
            fragmentId: fragment.fragmentId,
          };
          await tx.repositories.idempotency.complete(reservation.id, 202, response);
          return response;
        } finally {
          decisionDigest.fill(0);
        }
      },
      { isolation: "serializable" },
    );
  } finally {
    commitmentDigest.fill(0);
    nonce.fill(0);
    ciphertext.fill(0);
  }
}
