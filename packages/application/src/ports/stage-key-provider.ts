export type WorkflowFragmentPurpose = "DEATH" | "RECOVERY";

export type VersionedIngressKeyPair = Readonly<{
  version: number;
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}>;

export type VersionedStageKey = Readonly<{
  version: number;
  key: Uint8Array;
}>;

export interface StageKeyProvider {
  ingressKeyPair(
    purpose: WorkflowFragmentPurpose,
    version: number,
  ): Promise<VersionedIngressKeyPair>;
  currentStageKey(purpose: WorkflowFragmentPurpose): Promise<VersionedStageKey>;
  stageKey?(purpose: WorkflowFragmentPurpose, version: number): Promise<VersionedStageKey>;
}

export type FragmentEnvelopeContext = Readonly<{
  workflowId: string;
  contactId: string;
  generationId: string;
  shareIndex: number;
  purpose: WorkflowFragmentPurpose;
  commitmentDigest: Uint8Array;
  ingressKeyVersion: number;
}>;

export type FragmentVerificationContext = Readonly<
  FragmentEnvelopeContext & {
    vaultId: string;
    threshold: number;
    shareCount: number;
    shareCommitment: Uint8Array;
    generationCommitment: Uint8Array;
    vkCommitment: Uint8Array;
  }
>;

export interface FragmentCryptography {
  openIngress(
    input: Readonly<{
      context: FragmentEnvelopeContext;
      envelope: Readonly<{
        protocolVersion: 1;
        nonce: Uint8Array;
        ciphertext: Uint8Array;
      }>;
      keyPair: VersionedIngressKeyPair;
    }>,
  ): Promise<Uint8Array>;
  verifyShare(
    input: Readonly<{
      context: FragmentVerificationContext;
      plaintextShare: Uint8Array;
    }>,
  ): Promise<boolean>;
  wrapStage(
    input: Readonly<{
      context: FragmentEnvelopeContext;
      plaintextShare: Uint8Array;
      stageKey: Uint8Array;
      stageKeyVersion: number;
    }>,
  ): Promise<Readonly<{ protocolVersion: 1; nonce: Uint8Array; ciphertext: Uint8Array }>>;
}
