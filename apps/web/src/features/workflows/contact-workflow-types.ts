import type { ContactFragmentPurpose, ContactFragmentResult } from "../../crypto/contact-fragment";

export type ContactLegalAction = "CONFIRM_DEATH" | "CONFIRM_ALIVE" | "APPROVE_RECOVERY";

export type ContactWorkflowView = Readonly<{
  workflowId: string;
  kind: "DEATH_CONFIRMATION" | "PASSWORD_RECOVERY" | string;
  state: string;
  ownerDisplayName: string;
  startedAt?: string;
  expiresAt?: string | null;
  approvedCount: number;
  requiredCount: number;
  decisionAlreadyMade: boolean;
  legalNextActions: readonly ContactLegalAction[];
  share: Readonly<{
    generationId: string;
    shareIndex: number;
    protocolVersion: number;
    ciphertext: string;
    commitment: string;
  }>;
  ingress: Readonly<{
    purpose: ContactFragmentPurpose;
    version: number;
    publicKey: string;
  }>;
}>;

export type ContactCryptoMaterial = Readonly<{
  contactId: string;
  vaultId: string;
  publicKey: string;
  privateKeyEnvelope: Readonly<{
    ciphertext: string;
    nonce: string;
    kdfSalt: string;
    kdfParams?: Readonly<Record<string, unknown>>;
  }>;
}>;

export type ContactActionOutcome = Readonly<{
  state: "PENDING" | "CLOSED";
  message: string;
}>;

export type ContactActionDialogProps = Readonly<{
  open: boolean;
  workflow: ContactWorkflowView;
  onCancel: () => void;
  onComplete: (outcome: ContactActionOutcome) => void;
}>;

export type { ContactFragmentResult };
