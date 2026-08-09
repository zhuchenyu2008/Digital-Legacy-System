import { createDecipheriv, createHash, timingSafeEqual } from "node:crypto";
import {
  finalizePublication,
  type PublicationCryptography,
  type RepositoryRow,
  type StageKeyProvider,
  type TransactionManager,
} from "@dls/application";
import {
  canonicalizeAad,
  decryptStream,
  encodeBase64Url,
  unwrapKeyV1,
  WRAPPED_KEY_ALGORITHM,
} from "@dls/crypto/node";
import { createPgPool, PgTransactionManager } from "@dls/persistence";
import { createStorage, renderWill, ZipInspector } from "@dls/storage";
import { loadWorkerKeyCapabilities } from "../config/key-capabilities.js";
import { loadWorkerConfig } from "../config/load-config.js";
import { WorkerStageKeys } from "./process-release-fragment.handler.js";
import type { WorkerJob } from "./register-handlers.js";

function bytes(value: unknown, name: string, exact?: number): Uint8Array {
  if (!(value instanceof Uint8Array) || (exact !== undefined && value.length !== exact)) {
    throw new Error(`${name} is invalid`);
  }
  return new Uint8Array(value);
}

function positiveInteger(value: unknown, name: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${name} is invalid`);
  return parsed;
}

function aadDigest(aad: Parameters<typeof canonicalizeAad>[0]): Uint8Array {
  const encoded = canonicalizeAad(aad);
  try {
    return createHash("sha256").update(encoded).digest();
  } finally {
    encoded.fill(0);
  }
}

function assertAadHash(expected: unknown, aad: Parameters<typeof canonicalizeAad>[0]): void {
  const stored = bytes(expected, "wrapped key AAD hash", 32);
  const actual = aadDigest(aad);
  try {
    if (!timingSafeEqual(stored, actual)) throw new Error("wrapped key AAD hash does not match");
  } finally {
    stored.fill(0);
    actual.fill(0);
  }
}

function releaseAad(workflow: RepositoryRow, vault: RepositoryRow) {
  return {
    protocol: "DLS/RELEASE-STAGE/V1",
    version: 1,
    algorithm: WRAPPED_KEY_ALGORITHM,
    purpose: "release-stage-vk" as const,
    keyId: String(workflow.id),
    vaultId: String(vault.id),
  };
}

function packageAad(packageRow: RepositoryRow, vault: RepositoryRow) {
  const packageVersion = positiveInteger(packageRow.version_no, "package version");
  return {
    protocol: "dls-crypto-v1",
    version: 1,
    algorithm: WRAPPED_KEY_ALGORITHM,
    purpose: "package-dek" as const,
    keyId: `package-kek-${packageVersion}`,
    vaultId: String(vault.id),
    packageId: String(packageRow.id),
    packageVersion,
  };
}

async function* verifiedCiphertextHeader(
  chunks: AsyncIterable<Uint8Array>,
  expectedHeaderValue: unknown,
): AsyncIterable<Uint8Array> {
  const expectedHeader = bytes(expectedHeaderValue, "package stream header", 24);
  const iterator = chunks[Symbol.asyncIterator]();
  const leading: Uint8Array[] = [];
  let leadingBytes = 0;
  try {
    while (leadingBytes < 32) {
      const next = await iterator.next();
      if (next.done) throw new Error("DLSF stream is truncated before its header");
      const chunk = bytes(next.value, "package ciphertext chunk");
      leading.push(chunk);
      leadingBytes += chunk.length;
    }
    const first = Buffer.concat(
      leading.map((chunk) => Buffer.from(chunk)),
      leadingBytes,
    );
    if (!timingSafeEqual(first.subarray(8, 32), expectedHeader)) {
      first.fill(0);
      throw new Error("package stream header does not match authenticated metadata");
    }
    yield first;
    while (true) {
      const next = await iterator.next();
      if (next.done) break;
      yield bytes(next.value, "package ciphertext chunk");
    }
  } finally {
    expectedHeader.fill(0);
    for (const chunk of leading) chunk.fill(0);
    await iterator.return?.();
  }
}

export const workerPublicationCryptography: PublicationCryptography = {
  async unwrapReleaseVaultKey({ workflow, vault, session, stageKey }) {
    const aad = releaseAad(workflow, vault);
    if (Number(session.stage_key_protocol_version) !== 1) {
      throw new Error("release stage envelope protocol is unsupported");
    }
    return unwrapKeyV1({
      wrappingKey: stageKey,
      aad,
      envelope: {
        version: 1,
        algorithm: WRAPPED_KEY_ALGORITHM,
        purpose: "release-stage-vk",
        keyId: aad.keyId,
        nonce: encodeBase64Url(bytes(session.stage_key_nonce, "release stage nonce", 24)),
        ciphertext: encodeBase64Url(bytes(session.stage_key_envelope, "release stage envelope")),
      },
    });
  },
  async unwrapPackageDek({ package: packageRow, vault, vaultKey }) {
    const aad = packageAad(packageRow, vault);
    assertAadHash(packageRow.dek_envelope_aad_hash, aad);
    if (
      packageRow.dek_envelope_algorithm !== WRAPPED_KEY_ALGORITHM ||
      Number(packageRow.dek_envelope_protocol_version) !== 1
    ) {
      throw new Error("package DEK envelope protocol is unsupported");
    }
    return unwrapKeyV1({
      wrappingKey: vaultKey,
      aad,
      envelope: {
        version: 1,
        algorithm: WRAPPED_KEY_ALGORITHM,
        purpose: "package-dek",
        keyId: aad.keyId,
        nonce: encodeBase64Url(bytes(packageRow.dek_envelope_nonce, "package DEK nonce", 24)),
        ciphertext: encodeBase64Url(bytes(packageRow.dek_envelope, "package DEK envelope")),
      },
    });
  },
  async decryptPackage({ package: packageRow, vault, dek, ciphertext, onChunk }) {
    if (packageRow.cipher_algorithm !== "XCHACHA20_POLY1305_SECRETSTREAM_V1") {
      throw new Error("package stream algorithm is unsupported");
    }
    return decryptStream({
      key: dek,
      context: {
        vaultId: String(vault.id),
        packageId: String(packageRow.id),
        packageVersion: positiveInteger(packageRow.version_no, "package version"),
      },
      chunks: verifiedCiphertextHeader(ciphertext, packageRow.stream_header),
      onChunk,
    });
  },
};

function decryptOwnerDisplayName(
  secret: Uint8Array,
  snapshot: Readonly<{ ciphertext: Uint8Array; nonce: Uint8Array; keyVersion: number }>,
): string {
  if (
    snapshot.keyVersion !== 1 ||
    snapshot.nonce.length !== 12 ||
    snapshot.ciphertext.length <= 16
  ) {
    throw new Error("owner display name snapshot envelope is invalid");
  }
  const key = createHash("sha256").update(secret).digest();
  const ciphertext = Buffer.from(snapshot.ciphertext);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, snapshot.nonce);
    decipher.setAAD(Buffer.from("owner-display-name", "utf8"));
    decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
    return Buffer.concat([
      decipher.update(ciphertext.subarray(0, ciphertext.length - 16)),
      decipher.final(),
    ]).toString("utf8");
  } finally {
    key.fill(0);
    ciphertext.fill(0);
  }
}

export class PublicationFinalizeHandler {
  public constructor(
    private readonly transaction: TransactionManager,
    private readonly stageKeys: StageKeyProvider,
    private readonly storage: ReturnType<typeof createStorage>,
    private readonly fieldSecret: Uint8Array,
  ) {}

  public async handle(job: WorkerJob): Promise<void> {
    await finalizePublication(
      { workflowId: job.data.aggregateId, aggregateVersion: job.data.aggregateVersion },
      {
        transaction: this.transaction,
        stageKeys: this.stageKeys,
        storage: this.storage,
        cryptography: workerPublicationCryptography,
        archiveInspector: new ZipInspector(),
        willRenderer: renderWill,
        ownerDisplayName: async (snapshot) => decryptOwnerDisplayName(this.fieldSecret, snapshot),
      },
    );
  }
}

export async function createPublicationFinalizeHandler(): Promise<PublicationFinalizeHandler> {
  const config = loadWorkerConfig();
  const capabilities = await loadWorkerKeyCapabilities();
  const storageConfig =
    config.storage.driver === "filesystem"
      ? config.storage
      : {
          ...config.storage,
          endpoint:
            config.storage.endpoint?.toString() ??
            `https://s3.${config.storage.region}.amazonaws.com`,
        };
  return new PublicationFinalizeHandler(
    new PgTransactionManager(createPgPool({ connectionString: config.databaseUrl })),
    new WorkerStageKeys(capabilities),
    createStorage(storageConfig),
    config.security.sessionSecret,
  );
}
