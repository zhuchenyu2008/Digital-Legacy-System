import {
  contactKeyId,
  decodeBase64Url,
  deriveBrowserKey,
  encodeBase64Url,
  openShareV1,
  sealFragmentIngressV1,
  unwrapContactPrivateKey,
} from "@dls/crypto/browser";

export type ContactFragmentPurpose = "DEATH" | "RECOVERY";

export type ContactFragmentInput = Readonly<{
  password: string;
  workflowId: string;
  purpose: ContactFragmentPurpose;
  vaultId: string;
  contactId: string;
  threshold: number;
  publicKey: string;
  privateKeyEnvelope: Readonly<{
    ciphertext: string;
    nonce: string;
    kdfSalt: string;
  }>;
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

export type ContactFragmentResult = Readonly<{
  generationId: string;
  shareIndex: number;
  commitmentDigest: string;
  ingressKeyVersion: number;
  protocolVersion: 1;
  nonce: string;
  ciphertext: string;
}>;

function sharePurpose(purpose: ContactFragmentPurpose): "death-share" | "recovery-share" {
  return purpose === "DEATH" ? "death-share" : "recovery-share";
}

export async function createContactFragment(
  input: ContactFragmentInput,
): Promise<ContactFragmentResult> {
  if (input.ingress.purpose !== input.purpose) {
    throw new Error("工作流与分片入口用途不匹配");
  }
  if (input.share.protocolVersion !== 1) {
    throw new Error("联系人分片协议版本不受支持");
  }

  const publicKey = decodeBase64Url(input.publicKey);
  const commitment = decodeBase64Url(input.share.commitment);
  const ingressPublicKey = decodeBase64Url(input.ingress.publicKey);
  const contactKek = await deriveBrowserKey(input.password, {
    version: 1,
    algorithm: "argon2id13",
    opsLimit: 3,
    memLimit: 64 * 1024 * 1024,
    salt: input.privateKeyEnvelope.kdfSalt,
    outputBytes: 32,
  });
  let privateKey: Uint8Array | undefined;
  let plaintextShare: Uint8Array | undefined;
  let commitmentDigest: Uint8Array | undefined;
  try {
    const keyId = await contactKeyId(publicKey);
    privateKey = await unwrapContactPrivateKey({
      envelope: {
        version: 1,
        algorithm: "xchacha20poly1305-ietf",
        purpose: "contact-private-key",
        keyId,
        nonce: input.privateKeyEnvelope.nonce,
        ciphertext: input.privateKeyEnvelope.ciphertext,
      },
      publicKey,
      contactKek,
      vaultId: input.vaultId,
      contactId: input.contactId,
    });
    commitmentDigest = new Uint8Array(
      await crypto.subtle.digest("SHA-256", new Uint8Array(commitment).buffer),
    );
    const encodedCommitmentDigest = encodeBase64Url(commitmentDigest);
    plaintextShare = await openShareV1({
      envelope: {
        version: 1,
        algorithm: "crypto-box-seal",
        purpose: sharePurpose(input.purpose),
        vaultId: input.vaultId,
        generationId: input.share.generationId,
        contactId: input.contactId,
        shareIndex: input.share.shareIndex,
        threshold: input.threshold,
        commitmentDigest: encodedCommitmentDigest,
        ciphertext: input.share.ciphertext,
      },
      keyPair: { publicKey, privateKey },
      expected: {
        vaultId: input.vaultId,
        generationId: input.share.generationId,
        purpose: sharePurpose(input.purpose),
        contactId: input.contactId,
      },
    });
    const sealed = await sealFragmentIngressV1({
      workflowId: input.workflowId,
      contactId: input.contactId,
      generationId: input.share.generationId,
      shareIndex: input.share.shareIndex,
      purpose: input.purpose,
      commitmentDigest: encodedCommitmentDigest,
      ingressKeyVersion: input.ingress.version,
      share: plaintextShare,
      recipientPublicKey: ingressPublicKey,
    });
    return {
      generationId: sealed.generationId,
      shareIndex: sealed.shareIndex,
      commitmentDigest: sealed.commitmentDigest,
      ingressKeyVersion: sealed.ingressKeyVersion,
      protocolVersion: 1,
      nonce: sealed.nonce,
      ciphertext: sealed.ciphertext,
    };
  } finally {
    publicKey.fill(0);
    commitment.fill(0);
    ingressPublicKey.fill(0);
    contactKek.fill(0);
    privateKey?.fill(0);
    plaintextShare?.fill(0);
    commitmentDigest?.fill(0);
  }
}
