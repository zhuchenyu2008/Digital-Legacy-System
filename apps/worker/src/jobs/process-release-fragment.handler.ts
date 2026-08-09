import {
  type FragmentCryptography,
  type FragmentEnvelopeContext,
  type FragmentVerificationContext,
  processReleaseFragment,
  type ReleaseFragmentCryptography,
  type RepositoryRow,
  type StageKeyProvider,
  type TransactionManager,
} from "@dls/application";
import {
  commitVaultKey,
  createVssContext,
  decodeBase64Url,
  encodeBase64Url,
  FRAGMENT_INGRESS_ALGORITHM,
  openFragmentIngressV1,
  openStageFragmentV1,
  STAGE_FRAGMENT_ALGORITHM,
  wrapKeyV1,
  wrapStageFragmentV1,
} from "@dls/crypto/node";
import { createPgPool, PgTransactionManager } from "@dls/persistence";
import { combinePedersen, verifyPedersenShare } from "@dls/vss-wasm/node";
import {
  loadWorkerKeyCapabilities,
  type WorkerKeyCapabilities,
} from "../config/key-capabilities.js";
import { loadWorkerConfig } from "../config/load-config.js";
import type { WorkerJob } from "./register-handlers.js";

function bytes(value: unknown, name: string, exact?: number): Uint8Array {
  if (!(value instanceof Uint8Array) || (exact !== undefined && value.length !== exact)) {
    throw new Error(`${name} is invalid`);
  }
  return new Uint8Array(value);
}

function integer(value: unknown, name: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${name} is invalid`);
  return parsed;
}

function fragmentContext(row: RepositoryRow): FragmentEnvelopeContext {
  return {
    workflowId: String(row.workflow_id),
    contactId: String(row.contact_id),
    generationId: String(row.generation_id),
    shareIndex: integer(row.share_index, "share index"),
    purpose: row.purpose === "RECOVERY" ? "RECOVERY" : "DEATH",
    commitmentDigest: bytes(row.fragment_commitment_digest, "commitment digest", 32),
    ingressKeyVersion: integer(row.ingress_key_version, "ingress key version"),
  };
}

function expectedContext(context: FragmentEnvelopeContext) {
  return {
    ...context,
    commitmentDigest: encodeBase64Url(context.commitmentDigest),
  };
}

function vssContext(
  input: Readonly<{
    generation: RepositoryRow;
    vault: RepositoryRow;
    purpose: "DEATH" | "RECOVERY";
  }>,
): Uint8Array {
  return createVssContext({
    vaultId: String(input.generation.vault_id),
    generationId: String(input.generation.id),
    purpose: input.purpose,
    threshold: integer(
      input.purpose === "DEATH"
        ? input.generation.death_threshold
        : input.generation.recovery_threshold,
      "threshold",
    ),
    shareCount: integer(input.generation.contact_count, "share count"),
    vkCommitment: bytes(input.vault.vk_commitment, "VK commitment", 32),
  });
}

export class WorkerStageKeys implements StageKeyProvider {
  public constructor(private readonly capabilities: WorkerKeyCapabilities) {}

  public async ingressKeyPair(purpose: "DEATH" | "RECOVERY", version: number) {
    if (purpose !== "DEATH" || version !== this.capabilities.releaseIngress.version) {
      throw new Error("release ingress key version is unavailable");
    }
    return {
      version,
      publicKey: new Uint8Array(this.capabilities.releaseIngress.publicKey),
      privateKey: new Uint8Array(this.capabilities.releaseIngress.privateKey),
    };
  }

  public async currentStageKey(purpose: "DEATH" | "RECOVERY") {
    if (purpose !== "DEATH") throw new Error("recovery stage key is not mounted in worker");
    return {
      version: this.capabilities.releaseStage.version,
      key: new Uint8Array(this.capabilities.releaseStage.key),
    };
  }

  public async stageKey(purpose: "DEATH" | "RECOVERY", version: number) {
    const current = await this.currentStageKey(purpose);
    if (current.version !== version) {
      current.key.fill(0);
      throw new Error("historical release stage key version is unavailable");
    }
    return current;
  }
}

const fragmentCryptography: FragmentCryptography = {
  async openIngress({ context, envelope, keyPair }) {
    const expected = expectedContext(context);
    return openFragmentIngressV1({
      expected,
      recipientKeyPair: keyPair,
      envelope: {
        protocolVersion: 1,
        algorithm: FRAGMENT_INGRESS_ALGORITHM,
        ...expected,
        nonce: encodeBase64Url(envelope.nonce),
        ciphertext: encodeBase64Url(envelope.ciphertext),
      },
    });
  },
  async verifyShare({ context, plaintextShare }) {
    const verification = context as FragmentVerificationContext;
    const contextBytes = createVssContext({
      vaultId: verification.vaultId,
      generationId: verification.generationId,
      purpose: verification.purpose,
      threshold: verification.threshold,
      shareCount: verification.shareCount,
      vkCommitment: verification.vkCommitment,
    });
    try {
      return verifyPedersenShare(plaintextShare, verification.shareCommitment, contextBytes);
    } finally {
      contextBytes.fill(0);
    }
  },
  async wrapStage({ context, plaintextShare, stageKey, stageKeyVersion }) {
    const wrapped = await wrapStageFragmentV1({
      ...expectedContext(context),
      share: plaintextShare,
      stageKey,
      stageKeyVersion,
    });
    return {
      protocolVersion: 1,
      nonce: decodeBase64Url(wrapped.nonce),
      ciphertext: decodeBase64Url(wrapped.ciphertext),
    };
  },
};

const releaseCryptography: ReleaseFragmentCryptography = {
  async openStage({ fragment, stageKey }) {
    const context = fragmentContext(fragment);
    const stageKeyVersion = integer(fragment.stage_key_version, "stage key version");
    const expected = { ...expectedContext(context), stageKeyVersion };
    try {
      return await openStageFragmentV1({
        stageKey,
        expected,
        envelope: {
          protocolVersion: 1,
          algorithm: STAGE_FRAGMENT_ALGORITHM,
          ...expected,
          nonce: encodeBase64Url(bytes(fragment.fragment_nonce, "stage nonce", 24)),
          ciphertext: encodeBase64Url(bytes(fragment.fragment_ciphertext, "stage ciphertext")),
        },
      });
    } finally {
      context.commitmentDigest.fill(0);
    }
  },
  async verifyShare({ fragment, share, generation, vault }) {
    const contextBytes = vssContext({ generation, vault, purpose: "DEATH" });
    const commitments = bytes(fragment.fragment_commitment, "share commitment");
    try {
      return verifyPedersenShare(share, commitments, contextBytes);
    } finally {
      contextBytes.fill(0);
      commitments.fill(0);
    }
  },
  async reconstruct({ shares, fragments, generation, vault }) {
    const first = fragments[0];
    if (first === undefined) throw new Error("threshold fragments are unavailable");
    const commitments = bytes(first.fragment_commitment, "share commitment");
    for (const fragment of fragments.slice(1)) {
      const candidate = bytes(fragment.fragment_commitment, "share commitment");
      const same = Buffer.from(candidate).equals(Buffer.from(commitments));
      candidate.fill(0);
      if (!same) {
        commitments.fill(0);
        throw new Error("threshold fragments use mixed commitments");
      }
    }
    const contextBytes = vssContext({ generation, vault, purpose: "DEATH" });
    try {
      return combinePedersen(shares, commitments, contextBytes);
    } finally {
      commitments.fill(0);
      contextBytes.fill(0);
    }
  },
  commitVaultKey,
  async wrapReleaseVaultKey({ workflowId, vaultId, vaultKey, stageKey }) {
    const wrapped = await wrapKeyV1({
      key: vaultKey,
      wrappingKey: stageKey,
      aad: {
        protocol: "DLS/RELEASE-STAGE/V1",
        version: 1,
        algorithm: "xchacha20poly1305-ietf",
        purpose: "release-stage-vk",
        keyId: workflowId,
        vaultId,
      },
    });
    return {
      protocolVersion: 1,
      nonce: decodeBase64Url(wrapped.nonce),
      ciphertext: decodeBase64Url(wrapped.ciphertext),
    };
  },
};

export class ProcessReleaseFragmentHandler {
  public constructor(
    private readonly transaction: TransactionManager,
    private readonly stageKeys: StageKeyProvider,
  ) {}

  public async handle(job: WorkerJob): Promise<void> {
    await processReleaseFragment(
      { fragmentId: job.data.aggregateId },
      {
        transaction: this.transaction,
        stageKeys: this.stageKeys,
        fragmentCryptography,
        releaseCryptography,
      },
    );
  }
}

export async function createProcessReleaseFragmentHandler(): Promise<ProcessReleaseFragmentHandler> {
  const config = loadWorkerConfig();
  const pool = createPgPool({ connectionString: config.databaseUrl });
  const capabilities = await loadWorkerKeyCapabilities();
  return new ProcessReleaseFragmentHandler(
    new PgTransactionManager(pool),
    new WorkerStageKeys(capabilities),
  );
}
