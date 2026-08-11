import {
  commitVaultKey,
  createShareGeneration as createCryptoShareGeneration,
  createVssContext,
  decodeBase64Url,
  encodeBase64Url,
  sealShareGeneration,
} from "@dls/crypto/browser";
import { initializeBrowser, splitPedersen } from "@dls/vss-wasm/browser";

type ContactMaterial = Readonly<{ contactId: string; publicKey: string }>;

export type ShareGenerationWorkerInput = Readonly<{
  vaultKey: string;
  vaultId: string;
  generationId: string;
  contactSetVersion: number;
  contactsSnapshotSha256: string;
  deathThreshold: number;
  recoveryThreshold: number;
  contacts: readonly ContactMaterial[];
}>;

type Split = Readonly<{ shares: readonly Uint8Array[]; commitments: Uint8Array }>;

export type ShareGenerationDependencies = Readonly<{
  initialize(): Promise<void>;
  split(secret: Uint8Array, threshold: number, shareCount: number, context: Uint8Array): Split;
}>;

export type OwnerEnvelopeShareGenerationInput = Omit<ShareGenerationWorkerInput, "vaultKey"> &
  Readonly<{
    password: string;
    envelope: Readonly<Record<string, unknown>>;
  }>;

export async function buildShareGenerationUploadFromOwnerEnvelope(
  input: OwnerEnvelopeShareGenerationInput,
  dependencies: Readonly<{
    unwrapOwnerVault(
      input: Readonly<{
        password: string;
        envelope: Readonly<Record<string, unknown>>;
        vaultId: string;
      }>,
    ): Promise<Uint8Array>;
    shareGeneration?: ShareGenerationDependencies;
  }>,
) {
  const vaultKey = await dependencies.unwrapOwnerVault({
    password: input.password,
    envelope: input.envelope,
    vaultId: input.vaultId,
  });
  try {
    const { password: _password, envelope: _envelope, ...generationInput } = input;
    return await buildShareGenerationUpload(
      { ...generationInput, vaultKey: encodeBase64Url(vaultKey) },
      dependencies.shareGeneration,
    );
  } finally {
    vaultKey.fill(0);
  }
}

const defaultDependencies: ShareGenerationDependencies = {
  initialize: initializeBrowser,
  split: splitPedersen,
};

function concat(...values: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(values.reduce((size, value) => size + value.length, 0));
  let offset = 0;
  for (const value of values) {
    output.set(value, offset);
    offset += value.length;
  }
  return output;
}

function hex(value: Uint8Array): string {
  return [...value].map((item) => item.toString(16).padStart(2, "0")).join("");
}

function fromHex(value: string, field: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/u.test(value)) throw new Error(`${field} 必须是 32 字节小写十六进制摘要`);
  return Uint8Array.from(value.match(/.{2}/gu) ?? [], (pair) => Number.parseInt(pair, 16));
}

async function sha256(value: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(value).buffer));
}

async function generationProof(
  input: Readonly<{
    vaultId: string;
    generationId: string;
    contactsSnapshotSha256: Uint8Array;
    generationCommitment: Uint8Array;
    vkCommitment: Uint8Array;
  }>,
): Promise<Uint8Array> {
  const encoded = new TextEncoder().encode(
    JSON.stringify({
      context: "DLS/SHARE-GENERATION-PROOF/V1",
      contactsSnapshotSha256: encodeBase64Url(input.contactsSnapshotSha256),
      generationCommitment: encodeBase64Url(input.generationCommitment),
      generationId: input.generationId,
      vaultId: input.vaultId,
      vkCommitment: encodeBase64Url(input.vkCommitment),
    }),
  );
  try {
    return await sha256(encoded);
  } finally {
    encoded.fill(0);
  }
}

function clearSplit(value: Split | undefined): void {
  if (!value) return;
  value.commitments.fill(0);
  for (const share of value.shares) share.fill(0);
}

export async function buildShareGenerationUpload(
  input: ShareGenerationWorkerInput,
  dependencies: ShareGenerationDependencies = defaultDependencies,
) {
  if (input.contacts.length < 3) throw new Error("至少需要 3 名有效联系人才能生成分片");
  const vaultKey = decodeBase64Url(input.vaultKey);
  const contactsSnapshot = fromHex(input.contactsSnapshotSha256, "联系人快照");
  const contactKeys = input.contacts.map((contact) => ({
    contactId: contact.contactId,
    publicKey: decodeBase64Url(contact.publicKey),
  }));
  let vkCommitment: Uint8Array | undefined;
  let deathContext: Uint8Array | undefined;
  let recoveryContext: Uint8Array | undefined;
  let deathSplit: Split | undefined;
  let recoverySplit: Split | undefined;
  let generationCommitment: Uint8Array | undefined;
  let proof: Uint8Array | undefined;
  try {
    if (vaultKey.length !== 32) throw new Error("保险库密钥必须是 32 字节");
    for (const contact of contactKeys) {
      if (contact.contactId.length === 0 || contact.publicKey.length !== 32) {
        throw new Error("联系人公钥材料无效");
      }
    }
    await dependencies.initialize();
    vkCommitment = await commitVaultKey(vaultKey);
    deathContext = createVssContext({
      vaultId: input.vaultId,
      generationId: input.generationId,
      purpose: "DEATH",
      threshold: input.deathThreshold,
      shareCount: contactKeys.length,
      vkCommitment,
    });
    recoveryContext = createVssContext({
      vaultId: input.vaultId,
      generationId: input.generationId,
      purpose: "RECOVERY",
      threshold: input.recoveryThreshold,
      shareCount: contactKeys.length,
      vkCommitment,
    });
    deathSplit = dependencies.split(
      vaultKey,
      input.deathThreshold,
      contactKeys.length,
      deathContext,
    );
    recoverySplit = dependencies.split(
      vaultKey,
      input.recoveryThreshold,
      contactKeys.length,
      recoveryContext,
    );

    const deathGeneration = await createCryptoShareGeneration({
      vaultId: input.vaultId,
      generationId: input.generationId,
      purpose: "death-share",
      threshold: input.deathThreshold,
      shares: deathSplit.shares,
      commitments: deathSplit.commitments,
    });
    const recoveryGeneration = await createCryptoShareGeneration({
      vaultId: input.vaultId,
      generationId: input.generationId,
      purpose: "recovery-share",
      threshold: input.recoveryThreshold,
      shares: recoverySplit.shares,
      commitments: recoverySplit.commitments,
    });
    try {
      const [deathEnvelopes, recoveryEnvelopes] = await Promise.all([
        sealShareGeneration({ generation: deathGeneration, contacts: contactKeys }),
        sealShareGeneration({ generation: recoveryGeneration, contacts: contactKeys }),
      ]);
      const commitmentInput = concat(deathGeneration.commitments, recoveryGeneration.commitments);
      try {
        generationCommitment = await sha256(commitmentInput);
      } finally {
        commitmentInput.fill(0);
      }
      proof = await generationProof({
        vaultId: input.vaultId,
        generationId: input.generationId,
        contactsSnapshotSha256: contactsSnapshot,
        generationCommitment,
        vkCommitment,
      });
      return {
        contactSetVersion: input.contactSetVersion,
        contactsSnapshotSha256: input.contactsSnapshotSha256,
        protocolVersion: 1,
        vssScheme: "AUDITED_PUBLICLY_VERIFIABLE_SHARING_V1",
        generationCommitment: encodeBase64Url(generationCommitment),
        vkCommitment: hex(vkCommitment),
        generationProof: encodeBase64Url(proof),
        shares: input.contacts.map((contact, index) => {
          const death = deathEnvelopes[index];
          const recovery = recoveryEnvelopes[index];
          if (!death || !recovery) throw new Error("分片与联系人数量不一致");
          return {
            contactId: contact.contactId,
            shareIndex: index + 1,
            deathShareCiphertext: death.ciphertext,
            recoveryShareCiphertext: recovery.ciphertext,
            deathShareCommitment: encodeBase64Url(deathGeneration.commitments),
            recoveryShareCommitment: encodeBase64Url(recoveryGeneration.commitments),
          };
        }),
      } as const;
    } finally {
      deathGeneration.commitments.fill(0);
      recoveryGeneration.commitments.fill(0);
      for (const share of deathGeneration.shares) share.fill(0);
      for (const share of recoveryGeneration.shares) share.fill(0);
    }
  } finally {
    vaultKey.fill(0);
    contactsSnapshot.fill(0);
    vkCommitment?.fill(0);
    deathContext?.fill(0);
    recoveryContext?.fill(0);
    clearSplit(deathSplit);
    clearSplit(recoverySplit);
    generationCommitment?.fill(0);
    proof?.fill(0);
    for (const contact of contactKeys) contact.publicKey.fill(0);
  }
}
