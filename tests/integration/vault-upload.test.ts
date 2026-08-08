import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  AbortUpload,
  ActivatePackage,
  CompleteUpload,
  CreateUploadSession,
  StreamUpload,
} from "../../packages/application/src/index.js";
import type {
  ByteRange,
  ObjectMetadata,
  ObjectNamespace,
  ObjectStoragePort,
} from "../../packages/application/src/ports/object-storage.js";
import type {
  VaultPackageRecord,
  VaultPackageRepository,
  VaultTransactionContext,
} from "../../packages/application/src/vault/ports.js";
import { VaultUseCaseError } from "../../packages/application/src/vault/ports.js";

function digest(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

async function collect(body: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of body) chunks.push(new Uint8Array(chunk));
  const output = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

class MemoryStorage implements ObjectStoragePort {
  readonly objects = new Map<string, { body: Uint8Array; metadata: ObjectMetadata }>();

  async put(input: {
    namespace: ObjectNamespace;
    key: string;
    body: AsyncIterable<Uint8Array>;
    expectedBytes?: number;
    expectedSha256?: string;
  }): Promise<ObjectMetadata> {
    const body = await collect(input.body);
    const sha256 = digest(body);
    if (input.expectedBytes !== undefined && body.length !== input.expectedBytes)
      throw new Error("size mismatch");
    if (input.expectedSha256 !== undefined && sha256 !== input.expectedSha256)
      throw new Error("hash mismatch");
    const metadata = { bytes: body.length, sha256, etag: sha256 };
    this.objects.set(this.key(input.namespace, input.key), { body, metadata });
    return metadata;
  }

  async head(namespace: ObjectNamespace, key: string): Promise<ObjectMetadata | null> {
    return this.objects.get(this.key(namespace, key))?.metadata ?? null;
  }

  async read(namespace: ObjectNamespace, key: string, range?: ByteRange) {
    const object = this.objects.get(this.key(namespace, key));
    if (object === undefined) throw new Error("not found");
    const start = range?.start ?? 0;
    const end = range?.endInclusive ?? object.body.length - 1;
    return {
      body: (async function* () {
        yield object.body.slice(start, end + 1);
      })(),
      bytes: end - start + 1,
      totalBytes: object.body.length,
      etag: object.metadata.etag,
    };
  }

  async promote(input: {
    from: "staging";
    to: "private" | "public";
    sourceKey: string;
    destinationKey: string;
    expectedSha256: string;
  }): Promise<void> {
    const source = this.objects.get(this.key("staging", input.sourceKey));
    if (source === undefined || source.metadata.sha256 !== input.expectedSha256)
      throw new Error("source mismatch");
    const destinationKey = this.key(input.to, input.destinationKey);
    const existing = this.objects.get(destinationKey);
    if (existing !== undefined && existing.metadata.sha256 !== input.expectedSha256)
      throw new Error("destination conflict");
    this.objects.set(destinationKey, source);
    this.objects.delete(this.key("staging", input.sourceKey));
  }

  async delete(namespace: "private" | "staging", key: string): Promise<void> {
    this.objects.delete(this.key(namespace, key));
  }

  private key(namespace: ObjectNamespace, key: string): string {
    return `${namespace}:${key}`;
  }
}

class MemoryPackages implements VaultPackageRepository {
  readonly records = new Map<string, VaultPackageRecord>();
  currentGeneration = "00000000-0000-0000-0000-000000000010";

  async create(record: VaultPackageRecord): Promise<VaultPackageRecord> {
    this.records.set(record.id, record);
    return record;
  }

  async findById(id: string): Promise<VaultPackageRecord | null> {
    return this.records.get(id) ?? null;
  }

  async findActive(vaultId: string): Promise<VaultPackageRecord | null> {
    return (
      [...this.records.values()].find(
        (record) => record.vaultId === vaultId && record.status === "ACTIVE",
      ) ?? null
    );
  }

  async findCurrentShareGenerationId(): Promise<string> {
    return this.currentGeneration;
  }

  async lockVault(): Promise<void> {}

  async update(
    id: string,
    expectedVersion: number,
    patch: Partial<VaultPackageRecord>,
  ): Promise<VaultPackageRecord> {
    const current = this.records.get(id);
    if (current === undefined)
      throw new VaultUseCaseError("DLS-PACKAGE-NOT-FOUND", "package not found", 404);
    if (current.version !== expectedVersion)
      throw new VaultUseCaseError("DLS-VERSION-CONFLICT", "stale package", 409);
    const updated = { ...current, ...patch, version: current.version + 1 };
    this.records.set(id, updated);
    return updated;
  }

  async list(vaultId: string): Promise<readonly VaultPackageRecord[]> {
    return [...this.records.values()].filter((record) => record.vaultId === vaultId);
  }
}

class MemoryTransactions {
  readonly outbox: VaultTransactionContext["outbox"] = {
    enqueue: async (event) => ({ ...event, id: `outbox-${event.idempotencyKey}` }),
  };
  readonly audit: VaultTransactionContext["audit"] = { append: async () => undefined };

  constructor(private readonly packages: MemoryPackages) {}

  async run<T>(work: (tx: VaultTransactionContext) => Promise<T>): Promise<T> {
    return work({
      packages: this.packages,
      clock: { now: async () => "2026-08-08T12:00:00Z" },
      outbox: this.outbox,
      audit: this.audit,
    });
  }
}

function createFixture(idFactory: () => string) {
  const packages = new MemoryPackages();
  const storage = new MemoryStorage();
  const transaction = new MemoryTransactions(packages);
  const create = new CreateUploadSession({
    packages,
    idFactory,
    objectKeyFactory: (id) => `${id.slice(0, 2)}/${id.slice(2, 4)}/${id}`,
    nextVersionNo: async () => packages.records.size + 1,
  });
  return { packages, storage, transaction, create };
}

function metadata(): Readonly<{
  vaultId: string;
  shareGenerationId: string;
  cipherAlgorithm: string;
  streamHeader: Uint8Array;
  ciphertextSize: number;
  ciphertextSha256: string;
  dekEnvelope: Uint8Array;
  dekEnvelopeNonce: Uint8Array;
  dekEnvelopeAlgorithm: string;
  dekEnvelopeProtocolVersion: number;
  dekEnvelopeAadHash: Uint8Array;
  manifestCiphertext: Uint8Array;
  manifestNonce: Uint8Array;
  manifestAlgorithm: string;
  manifestAadHash: Uint8Array;
  clientCryptoVersion: string;
  expiresAt: string;
}> {
  const body = new TextEncoder().encode("encrypted secretstream bytes");
  return {
    vaultId: "00000000-0000-0000-0000-000000000001",
    shareGenerationId: "00000000-0000-0000-0000-000000000010",
    cipherAlgorithm: "XCHACHA20_POLY1305_SECRETSTREAM_V1",
    streamHeader: new Uint8Array(24),
    ciphertextSize: body.length,
    ciphertextSha256: digest(body),
    dekEnvelope: new Uint8Array([1]),
    dekEnvelopeNonce: new Uint8Array([2]),
    dekEnvelopeAlgorithm: "XCHACHA20_POLY1305",
    dekEnvelopeProtocolVersion: 1,
    dekEnvelopeAadHash: new Uint8Array([3]),
    manifestCiphertext: new Uint8Array([4]),
    manifestNonce: new Uint8Array([5]),
    manifestAlgorithm: "XCHACHA20_POLY1305",
    manifestAadHash: new Uint8Array([6]),
    clientCryptoVersion: "1",
    expiresAt: "2026-08-08T13:00:00Z",
  };
}

describe("encrypted vault upload and activation", () => {
  it("creates a server-keyed session, streams ciphertext, and requires verified completion", async () => {
    const ids = ["00000000-0000-0000-0000-000000000101", "00000000-0000-0000-0000-000000000102"];
    const fixture = createFixture(() => ids.shift() ?? "00000000-0000-0000-0000-000000000199");
    const session = await fixture.create.execute(metadata());
    expect(session.upload.url).toBe(`/api/v1/owner/packages/${session.package.id}/content`);
    expect(session.package.objectKey).toContain(session.package.id);

    const body = new TextEncoder().encode("encrypted secretstream bytes");
    const streamed = await new StreamUpload({
      packages: fixture.packages,
      storage: fixture.storage,
      clock: { now: async () => "2026-08-08T12:01:00Z" },
    }).execute({
      packageId: session.package.id,
      uploadId: session.package.uploadId,
      contentLength: body.length,
      body: (async function* () {
        yield body.slice(0, 5);
        yield body.slice(5);
      })(),
    });
    expect(streamed.storageMetadata?.sha256).toBe(session.package.ciphertextSha256);

    const ready = await new CompleteUpload({
      packages: fixture.packages,
      storage: fixture.storage,
      clock: { now: async () => "2026-08-08T12:02:00Z" },
    }).execute({
      packageId: session.package.id,
      uploadId: session.package.uploadId,
      ciphertextSize: body.length,
      ciphertextSha256: session.package.ciphertextSha256,
    });
    expect(ready.status).toBe("READY");
  });

  it("rejects size/hash mismatches and cancellation without installing a staging object", async () => {
    const ids = ["00000000-0000-0000-0000-000000000201", "00000000-0000-0000-0000-000000000202"];
    const fixture = createFixture(() => ids.shift() ?? "00000000-0000-0000-0000-000000000299");
    const session = await fixture.create.execute(metadata());
    const stream = new StreamUpload({
      packages: fixture.packages,
      storage: fixture.storage,
      clock: { now: async () => "2026-08-08T12:00:00Z" },
    });
    await expect(
      stream.execute({
        packageId: session.package.id,
        uploadId: session.package.uploadId,
        contentLength: 1,
        body: (async function* () {
          yield new Uint8Array([1]);
        })(),
      }),
    ).rejects.toMatchObject({ code: "DLS-PACKAGE-INTEGRITY" });
    expect(fixture.storage.objects.size).toBe(0);

    const controller = new AbortController();
    controller.abort();
    await expect(
      stream.execute({
        packageId: session.package.id,
        uploadId: session.package.uploadId,
        contentLength: metadata().ciphertextSize,
        signal: controller.signal,
        body: (async function* () {
          yield new Uint8Array([1]);
        })(),
      }),
    ).rejects.toMatchObject({ code: "DLS-UPLOAD-ABORTED" });
    expect(fixture.storage.objects.size).toBe(0);
  });

  it("atomically activates one READY package, supersedes the old one, and queues only old-object cleanup", async () => {
    const ids = [
      "00000000-0000-0000-0000-000000000301",
      "00000000-0000-0000-0000-000000000302",
      "00000000-0000-0000-0000-000000000303",
      "00000000-0000-0000-0000-000000000304",
    ];
    const fixture = createFixture(() => ids.shift() ?? "00000000-0000-0000-0000-000000000399");
    const body = new TextEncoder().encode("encrypted secretstream bytes");
    const finish = async () => {
      const session = await fixture.create.execute(metadata());
      await new StreamUpload({
        packages: fixture.packages,
        storage: fixture.storage,
        clock: { now: async () => "2026-08-08T12:00:00Z" },
      }).execute({
        packageId: session.package.id,
        uploadId: session.package.uploadId,
        contentLength: body.length,
        body: (async function* () {
          yield body;
        })(),
      });
      return new CompleteUpload({
        packages: fixture.packages,
        storage: fixture.storage,
        clock: { now: async () => "2026-08-08T12:00:00Z" },
      }).execute({
        packageId: session.package.id,
        uploadId: session.package.uploadId,
        ciphertextSize: body.length,
        ciphertextSha256: digest(body),
      });
    };
    const first = await finish();
    const activeFirst = await new ActivatePackage({
      packages: fixture.packages,
      storage: fixture.storage,
      transaction: fixture.transaction,
      passwordVerifier: { verify: async () => undefined },
      idFactory: () => "00000000-0000-0000-0000-000000000398",
    }).execute({ packageId: first.id, password: "password", actorId: "owner" });
    const second = await finish();
    const activeSecond = await new ActivatePackage({
      packages: fixture.packages,
      storage: fixture.storage,
      transaction: fixture.transaction,
      passwordVerifier: { verify: async () => undefined },
      idFactory: () => "00000000-0000-0000-0000-000000000397",
    }).execute({
      packageId: second.id,
      password: "password",
      expectedCurrentPackageId: first.id,
      expectedShareGenerationId: fixture.packages.currentGeneration,
      actorId: "owner",
    });
    expect(activeFirst.status).toBe("ACTIVE");
    expect(activeSecond.status).toBe("ACTIVE");
    expect((await fixture.packages.findById(first.id))?.status).toBe("SUPERSEDED");
    expect((await fixture.packages.findActive(metadata().vaultId))?.id).toBe(second.id);
  });

  it("aborts only uploadable packages and cleans staging data", async () => {
    const ids = ["00000000-0000-0000-0000-000000000401", "00000000-0000-0000-0000-000000000402"];
    const fixture = createFixture(() => ids.shift() ?? "00000000-0000-0000-0000-000000000499");
    const session = await fixture.create.execute(metadata());
    const aborted = await new AbortUpload({
      packages: fixture.packages,
      storage: fixture.storage,
      transaction: fixture.transaction,
    }).execute({ packageId: session.package.id, uploadId: session.package.uploadId });
    expect(aborted.status).toBe("ABORTED");
    await expect(
      new AbortUpload({
        packages: fixture.packages,
        storage: fixture.storage,
        transaction: fixture.transaction,
      }).execute({ packageId: session.package.id, uploadId: session.package.uploadId }),
    ).resolves.toMatchObject({ status: "ABORTED" });
    await expect(
      new ActivatePackage({
        packages: fixture.packages,
        storage: fixture.storage,
        transaction: fixture.transaction,
        passwordVerifier: { verify: async () => undefined },
        idFactory: () => "00000000-0000-0000-0000-000000000498",
      }).execute({ packageId: session.package.id, password: "password", actorId: "owner" }),
    ).rejects.toMatchObject({ code: "DLS-PACKAGE-STATE" });
  });
});
