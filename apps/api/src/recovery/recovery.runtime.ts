import {
  type ApproveRecoveryCommand,
  type ApproveRecoveryResult,
  approveRecovery,
  type CompletePasswordResetCommand,
  type CompletePasswordResetResult,
  type CreateRewrapSessionResult,
  completePasswordReset,
  createNotification,
  createRewrapSession,
  type FragmentCryptography,
  type FragmentEnvelopeContext,
  type FragmentVerificationContext,
  type RecoveryCryptography,
  type RepositoryRow,
  type RequestRecoveryResult,
  requestRecovery,
  type SessionService,
  type StageKeyProvider,
  type StartRecoveryResult,
  startRecovery,
  type TransactionManager,
} from "@dls/application";
import {
  AesNotificationCipher,
  commitVaultKey,
  createVssContext,
  decodeBase64Url,
  encodeBase64Url,
  FRAGMENT_INGRESS_ALGORITHM,
  hashServerPassword,
  openFragmentIngressV1,
  openStageFragmentV1,
  STAGE_FRAGMENT_ALGORITHM,
  sealRecoveryVaultKeyV1,
  unwrapKeyV1,
  verifyRecoveryReplacementProofsV1,
  verifyServerPassword,
  wrapKeyV1,
  wrapStageFragmentV1,
} from "@dls/crypto/node";
import { renderTemplate, TEMPLATE_CODES, type TemplateCode } from "@dls/email-templates";
import { createPgPool, PgTransactionManager } from "@dls/persistence";
import { combinePedersen, verifyPedersenShare } from "@dls/vss-wasm/node";
import { getApiRuntimeConfig } from "../config/api-runtime-config.js";
import { type ApiKeyCapabilities, loadApiKeyCapabilities } from "../config/key-capabilities.js";
import { AesFieldProtector } from "../setup/setup.runtime.js";
import { RecoveryNotifications } from "./recovery-notifications.js";

export const RECOVERY_RUNTIME = Symbol("DLS_RECOVERY_RUNTIME");

export interface RecoveryRuntime {
  request(requestId: string): Promise<RequestRecoveryResult>;
  start(command: Readonly<{ token: string; requestId: string }>): Promise<StartRecoveryResult>;
  approve(command: ApproveRecoveryCommand): Promise<ApproveRecoveryResult>;
  material(
    command: Readonly<{
      token: string;
      emailVerificationCode: string;
      clientEphemeralPublicKey: Uint8Array;
    }>,
  ): Promise<CreateRewrapSessionResult>;
  complete(command: CompletePasswordResetCommand): Promise<CompletePasswordResetResult>;
}

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
    purpose: "RECOVERY",
    commitmentDigest: bytes(row.fragment_commitment_digest, "commitment digest", 32),
    ingressKeyVersion: integer(row.ingress_key_version, "ingress key version"),
  };
}

function expectedContext(context: FragmentEnvelopeContext) {
  return { ...context, commitmentDigest: encodeBase64Url(context.commitmentDigest) };
}

function recoveryVssContext(generation: RepositoryRow, vault: RepositoryRow): Uint8Array {
  return createVssContext({
    vaultId: String(generation.vault_id),
    generationId: String(generation.id),
    purpose: "RECOVERY",
    threshold: integer(generation.recovery_threshold, "recovery threshold"),
    shareCount: integer(generation.contact_count, "share count"),
    vkCommitment: bytes(vault.vk_commitment, "VK commitment", 32),
  });
}

export class ApiRecoveryStageKeys implements StageKeyProvider {
  public constructor(private readonly capabilities: ApiKeyCapabilities) {}

  public async ingressKeyPair(purpose: "DEATH" | "RECOVERY", version: number) {
    if (purpose !== "RECOVERY" || version !== this.capabilities.recoveryIngress.version) {
      throw new Error("recovery ingress key version is unavailable");
    }
    return {
      version,
      publicKey: new Uint8Array(this.capabilities.recoveryIngress.publicKey),
      privateKey: new Uint8Array(this.capabilities.recoveryIngress.privateKey),
    };
  }

  public async currentStageKey(purpose: "DEATH" | "RECOVERY") {
    if (purpose !== "RECOVERY") throw new Error("release stage key is not mounted in API");
    return {
      version: this.capabilities.recoveryStage.version,
      key: new Uint8Array(this.capabilities.recoveryStage.key),
    };
  }

  public async stageKey(purpose: "DEATH" | "RECOVERY", version: number) {
    const current = await this.currentStageKey(purpose);
    if (current.version !== version) {
      current.key.fill(0);
      throw new Error("historical recovery stage key version is unavailable");
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
      purpose: "RECOVERY",
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

function createRecoveryCryptography(stageKeys: StageKeyProvider): RecoveryCryptography {
  return {
    async openStageShare({ fragment, stageKey }) {
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
      const context = recoveryVssContext(generation, vault);
      const commitments = bytes(fragment.fragment_commitment, "share commitment");
      try {
        return verifyPedersenShare(share, commitments, context);
      } finally {
        context.fill(0);
        commitments.fill(0);
      }
    },
    async reconstruct({ shares, fragments, generation, vault }) {
      const first = fragments[0];
      if (first === undefined) throw new Error("recovery fragments are unavailable");
      const commitments = bytes(first.fragment_commitment, "share commitment");
      for (const fragment of fragments.slice(1)) {
        const candidate = bytes(fragment.fragment_commitment, "share commitment");
        const matches = Buffer.from(candidate).equals(Buffer.from(commitments));
        candidate.fill(0);
        if (!matches) {
          commitments.fill(0);
          throw new Error("recovery fragments use mixed commitments");
        }
      }
      const context = recoveryVssContext(generation, vault);
      try {
        return combinePedersen(shares, commitments, context);
      } finally {
        commitments.fill(0);
        context.fill(0);
      }
    },
    async commitVaultKey(vaultKey) {
      return commitVaultKey(vaultKey);
    },
    async wrapRecoveryVaultKey({ workflowId, vaultKey, stageKey }) {
      const wrapped = await wrapKeyV1({
        key: vaultKey,
        wrappingKey: stageKey,
        aad: {
          protocol: "DLS/RECOVERY-STAGE/V1",
          version: 1,
          algorithm: "xchacha20poly1305-ietf",
          purpose: "recovery-stage-vk",
          keyId: workflowId,
          vaultId: workflowId,
        },
      });
      return {
        protocolVersion: 1,
        nonce: decodeBase64Url(wrapped.nonce),
        ciphertext: decodeBase64Url(wrapped.ciphertext),
      };
    },
    async openRecoveryVaultKey({ session }) {
      const workflowId = String(session.workflow_id);
      const stage =
        stageKeys.stageKey === undefined
          ? await stageKeys.currentStageKey("RECOVERY")
          : await stageKeys.stageKey(
              "RECOVERY",
              integer(session.stage_key_version, "stage key version"),
            );
      try {
        return await unwrapKeyV1({
          envelope: {
            version: 1,
            algorithm: "xchacha20poly1305-ietf",
            purpose: "recovery-stage-vk",
            keyId: workflowId,
            nonce: encodeBase64Url(bytes(session.stage_key_nonce, "stage VK nonce", 24)),
            ciphertext: encodeBase64Url(bytes(session.stage_key_envelope, "stage VK ciphertext")),
          },
          wrappingKey: stage.key,
          aad: {
            protocol: "DLS/RECOVERY-STAGE/V1",
            version: 1,
            algorithm: "xchacha20poly1305-ietf",
            purpose: "recovery-stage-vk",
            keyId: workflowId,
            vaultId: workflowId,
          },
        });
      } finally {
        stage.key.fill(0);
      }
    },
    async sealVaultKey({ workflowId, vaultKey, clientEphemeralPublicKey }) {
      return sealRecoveryVaultKeyV1({
        workflowId,
        vaultKey,
        recipientPublicKey: clientEphemeralPublicKey,
      });
    },
  };
}

export class PostgresRecoveryRuntime implements RecoveryRuntime {
  readonly #tokenPepper = getApiRuntimeConfig().tokenPepper;
  readonly #config = getApiRuntimeConfig();
  readonly #notifications: RecoveryNotifications;
  #capabilities: Promise<ApiKeyCapabilities> | undefined;

  public constructor(
    private readonly transaction: TransactionManager,
    private readonly sessions: SessionService,
  ) {
    const protector = new AesFieldProtector(this.#config.fieldKeyring, this.#config.sessionSecret);
    const cipher = new AesNotificationCipher(this.#config.fieldKeyring, this.#config.sessionSecret);
    const renderer = {
      render: (code: string, context: Readonly<Record<string, unknown>>) => {
        if (!TEMPLATE_CODES.includes(code as TemplateCode)) {
          throw new Error("Unknown email template code");
        }
        return renderTemplate(code as TemplateCode, context);
      },
    };
    this.#notifications = new RecoveryNotifications({
      transaction,
      publicBaseUrl: this.#config.publicBaseUrl,
      unprotect: (value, purpose) => protector.unprotect(value, purpose),
      enqueue: (command) =>
        createNotification(command, {
          transaction,
          cipher,
          renderer,
        }).then(() => undefined),
    });
  }

  public request(requestId: string) {
    return requestRecovery(
      { requestId },
      {
        transaction: this.transaction,
        tokenPepper: this.#tokenPepper,
        onPrimaryStartToken: (challenge) => this.#notifications.ownerStart(challenge),
      },
    );
  }

  public async start(command: Readonly<{ token: string; requestId: string }>) {
    const result = await startRecovery(command, {
      transaction: this.transaction,
      tokenPepper: this.#tokenPepper,
    });
    await this.#notifications.contacts(result);
    return result;
  }

  public async approve(command: ApproveRecoveryCommand) {
    const stageKeys = await this.stageKeys();
    return approveRecovery(command, {
      transaction: this.transaction,
      passwordVerifier: (password, hash) =>
        verifyServerPassword(password, getApiRuntimeConfig().contactPasswordPepper, hash),
      stageKeys,
      fragmentCryptography,
      recoveryCryptography: createRecoveryCryptography(stageKeys),
      tokenPepper: this.#tokenPepper,
      onPrimaryResetChallenge: (challenge) => this.#notifications.ownerReset(challenge),
    });
  }

  public async material(
    command: Readonly<{
      token: string;
      emailVerificationCode: string;
      clientEphemeralPublicKey: Uint8Array;
    }>,
  ) {
    const stageKeys = await this.stageKeys();
    return createRewrapSession(command, {
      transaction: this.transaction,
      tokenPepper: this.#tokenPepper,
      recoveryCryptography: createRecoveryCryptography(stageKeys),
    });
  }

  public async complete(command: CompletePasswordResetCommand) {
    const stageKeys = await this.stageKeys();
    return completePasswordReset(command, {
      transaction: this.transaction,
      sessionService: this.sessions,
      tokenPepper: this.#tokenPepper,
      recoveryCryptography: createRecoveryCryptography(stageKeys),
      passwordHasher: (password) => hashServerPassword(password, this.#tokenPepper),
      replacementVerifier: ({ envelope, vaultKeyProof, ...input }) =>
        verifyRecoveryReplacementProofsV1({
          ...input,
          envelope,
          ownerEnvelopeProof: envelope.ownerEnvelopeProof,
          vaultKeyProof,
        }),
    });
  }

  private async stageKeys(): Promise<ApiRecoveryStageKeys> {
    this.#capabilities ??= loadApiKeyCapabilities();
    return new ApiRecoveryStageKeys(await this.#capabilities);
  }
}

export function createRecoveryRuntime(sessions: SessionService): RecoveryRuntime {
  const pool = createPgPool({ connectionString: getApiRuntimeConfig().databaseUrl });
  return new PostgresRecoveryRuntime(new PgTransactionManager(pool), sessions);
}
