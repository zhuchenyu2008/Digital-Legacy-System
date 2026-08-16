import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type {
  ObjectMetadata,
  ObjectNamespace,
  ObjectStoragePort,
} from "../ports/object-storage.js";
import type { TransactionContext } from "../ports/transaction-manager.js";
import { finalizePublication } from "./finalize-publication.js";
import { getPublication } from "./get-publication.js";
import { openPublicDownload } from "./open-public-download.js";

type Row = Record<string, unknown>;

async function collect(body: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of body) chunks.push(new Uint8Array(chunk));
  const output = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

class MemoryStorage implements ObjectStoragePort {
  readonly objects = new Map<string, Uint8Array>();

  async put(input: {
    namespace: ObjectNamespace;
    key: string;
    body: AsyncIterable<Uint8Array>;
    expectedBytes?: number;
    expectedSha256?: string;
  }): Promise<ObjectMetadata> {
    const body = await collect(input.body);
    const digest = sha256(body);
    if (input.expectedBytes !== undefined && input.expectedBytes !== body.length)
      throw new Error("size");
    if (input.expectedSha256 !== undefined && input.expectedSha256 !== digest)
      throw new Error("digest");
    const key = `${input.namespace}:${input.key}`;
    const existing = this.objects.get(key);
    if (existing !== undefined && sha256(existing) !== digest) throw new Error("object conflict");
    this.objects.set(key, body);
    return { bytes: body.length, sha256: digest, etag: digest };
  }

  async head(namespace: ObjectNamespace, key: string): Promise<ObjectMetadata | null> {
    const body = this.objects.get(`${namespace}:${key}`);
    return body === undefined
      ? null
      : { bytes: body.length, sha256: sha256(body), etag: sha256(body) };
  }

  async read(
    namespace: ObjectNamespace,
    key: string,
    range?: { start: number; endInclusive?: number },
  ) {
    const body = this.objects.get(`${namespace}:${key}`);
    if (body === undefined) throw new Error("not found");
    const start = range?.start ?? 0;
    const end = range?.endInclusive ?? body.length - 1;
    return {
      body: (async function* () {
        yield body.slice(start, end + 1);
      })(),
      bytes: end - start + 1,
      totalBytes: body.length,
      etag: sha256(body),
    };
  }

  async promote(input: {
    from: "staging";
    to: "private" | "public";
    sourceKey: string;
    destinationKey: string;
    expectedSha256: string;
  }): Promise<void> {
    const source = this.objects.get(`staging:${input.sourceKey}`);
    if (source === undefined || sha256(source) !== input.expectedSha256) throw new Error("source");
    const destination = `public:${input.destinationKey}`;
    const existing = this.objects.get(destination);
    if (existing !== undefined && sha256(existing) !== input.expectedSha256)
      throw new Error("conflict");
    this.objects.set(destination, source);
    this.objects.delete(`staging:${input.sourceKey}`);
  }

  async delete(namespace: "private" | "staging", key: string): Promise<void> {
    this.objects.delete(`${namespace}:${key}`);
  }
}

function fixture() {
  const workflowId = "00000000-0000-4000-8000-000000000801";
  const packageId = "00000000-0000-4000-8000-000000000802";
  const publicationId = "00000000-0000-4000-8000-000000000803";
  const plaintextZip = new TextEncoder().encode("validated zip bytes");
  const ciphertext = new TextEncoder().encode("authenticated ciphertext");
  const willSource = "# 最后的话";
  const willBytes = new TextEncoder().encode(willSource);
  const now = "2026-08-09T04:00:00Z";
  const tables = new Map<string, Row[]>([
    [
      "workflows",
      [
        {
          id: workflowId,
          kind: "DEATH_CONFIRMATION",
          state: "RELEASE_PENDING",
          share_generation_id: "00000000-0000-4000-8000-000000000806",
          package_id: packageId,
          package_version_snapshot: 3,
          publish_locked_at: "2026-08-09T03:59:00Z",
          contact_count_snapshot: 3,
          required_count_snapshot: 3,
          approved_count: 3,
          owner_display_name_snapshot_ciphertext: new TextEncoder().encode("张三"),
          owner_display_name_snapshot_nonce: new Uint8Array(12),
          owner_display_name_snapshot_key_version: 1,
          version: 5,
        },
      ],
    ],
    [
      "shareGenerations",
      [
        {
          id: "00000000-0000-4000-8000-000000000806",
          vault_id: "00000000-0000-4000-8000-000000000807",
          status: "ACTIVE",
          version: 0,
        },
      ],
    ],
    [
      "vaults",
      [
        {
          id: "00000000-0000-4000-8000-000000000807",
          status: "ACTIVE",
          version: 0,
        },
      ],
    ],
    [
      "packages",
      [
        {
          id: packageId,
          status: "ACTIVE",
          version_no: 3,
          object_key: "private/package.dlsf",
          ciphertext_size: ciphertext.length,
          ciphertext_sha256: Buffer.from(sha256(ciphertext), "hex"),
          version: 0,
        },
      ],
    ],
    [
      "releaseSecretSessions",
      [
        {
          id: "00000000-0000-4000-8000-000000000804",
          workflow_id: workflowId,
          stage_key_envelope: new Uint8Array(48),
          stage_key_nonce: new Uint8Array(24),
          stage_key_version: 1,
          status: "ACTIVE",
          version: 0,
        },
      ],
    ],
    [
      "workflowContacts",
      [{ workflow_id: workflowId, contact_id: "00000000-0000-4000-8000-000000000805", version: 0 }],
    ],
    ["publications", []],
    ["publicEvents", []],
  ]);
  const repository = (name: string) => ({
    async findById(id: unknown) {
      return tables.get(name)?.find((row) => row.id === id) ?? null;
    },
    async findOneBy(field: string, value: unknown) {
      return tables.get(name)?.find((row) => row[field] === value) ?? null;
    },
    async findFirst() {
      return tables.get(name)?.[0] ?? null;
    },
    async findMany(field?: string, value?: unknown) {
      const rows = tables.get(name) ?? [];
      return field === undefined ? rows : rows.filter((row) => row[field] === value);
    },
    async insert(input: Row) {
      const row = { ...input, version: Number(input.version ?? 0) };
      tables.set(name, [...(tables.get(name) ?? []), row]);
      return row;
    },
    async updateVersioned(id: unknown, version: number, patch: Row) {
      const row = tables.get(name)?.find((candidate) => candidate.id === id);
      if (row === undefined || row.version !== version) throw new Error("version conflict");
      Object.assign(row, patch, { version: version + 1 });
      return row;
    },
  });
  const outbox: Row[] = [];
  const audits: Row[] = [];
  const context = {
    repositories: {
      workflows: repository("workflows"),
      shareGenerations: repository("shareGenerations"),
      vaults: repository("vaults"),
      packages: repository("packages"),
      releaseSecretSessions: repository("releaseSecretSessions"),
      workflowContacts: repository("workflowContacts"),
      publications: repository("publications"),
      publicEvents: repository("publicEvents"),
    },
    clock: { now: async () => now },
    outbox: {
      enqueue: async (event: Row) => {
        outbox.push(event);
        return event;
      },
    },
    audit: { append: async (event: Row) => void audits.push(event) },
  } as unknown as TransactionContext;
  const transaction = {
    run: async <T>(work: (tx: TransactionContext) => Promise<T>) => work(context),
  };
  const storage = new MemoryStorage();
  storage.objects.set("private:private/package.dlsf", ciphertext);
  const dependencies = {
    transaction,
    storage,
    stageKeys: {
      currentStageKey: async () => ({ version: 1, key: new Uint8Array(32).fill(1) }),
      stageKey: async () => ({ version: 1, key: new Uint8Array(32).fill(1) }),
      ingressKeyPair: async () => ({
        version: 1,
        publicKey: new Uint8Array(32),
        privateKey: new Uint8Array(32),
      }),
    },
    cryptography: {
      unwrapReleaseVaultKey: async () => new Uint8Array(32).fill(2),
      unwrapPackageDek: async () => new Uint8Array(32).fill(3),
      decryptPackage: async ({ onChunk }: { onChunk: (chunk: Uint8Array) => Promise<void> }) => {
        await onChunk(plaintextZip.slice(0, 5));
        await onChunk(plaintextZip.slice(5));
        return { plaintextBytes: plaintextZip.length, frameCount: 2 };
      },
    },
    archiveInspector: {
      inspect: async () => ({
        archiveBytes: plaintextZip.length,
        entries: [
          {
            path: "will.md",
            bytes: willBytes.length,
            compressedBytes: willBytes.length,
            directory: false,
            encrypted: false,
            symlink: false,
          },
        ],
        will: {
          path: "will.md" as const,
          bytes: willBytes.length,
          sha256: sha256(willBytes),
          body: (async function* () {
            yield willBytes;
          })(),
        },
      }),
    },
    willRenderer: (source: string) => ({
      html: `<h1>${source.slice(2)}</h1>`,
      sourceSha256: sha256(new TextEncoder().encode(source)),
    }),
    ownerDisplayName: async (snapshot: { ciphertext: Uint8Array }) =>
      new TextDecoder().decode(snapshot.ciphertext),
    idFactory: () => publicationId,
  };
  return {
    workflowId,
    publicationId,
    plaintextZip,
    tables,
    outbox,
    audits,
    storage,
    transaction,
    dependencies,
  };
}

describe("immutable publication", () => {
  it("promotes a content-addressed ZIP and commits visibility, audit, destruction, and notifications atomically", async () => {
    const state = fixture();
    await expect(
      finalizePublication(
        { workflowId: state.workflowId, aggregateVersion: 5 },
        state.dependencies,
      ),
    ).resolves.toMatchObject({ status: "PUBLISHED", publicationId: state.publicationId });
    const publication = state.tables.get("publications")?.[0];
    expect(publication).toMatchObject({
      public_slug: "legacy",
      zip_size: state.plaintextZip.length,
    });
    expect(String(publication?.public_object_key)).toMatch(
      /^legacy\/[0-9a-f]{2}\/[0-9a-f]{64}\.zip$/u,
    );
    expect(state.tables.get("workflows")?.[0]).toMatchObject({
      state: "RELEASED",
      end_reason: "PUBLISHED",
    });
    expect(state.tables.get("releaseSecretSessions")?.[0]).toMatchObject({
      status: "CONSUMED",
      stage_key_envelope: null,
      stage_key_nonce: null,
    });
    expect(state.tables.get("publicEvents")?.length).toBeGreaterThanOrEqual(5);
    expect(state.outbox).toHaveLength(1);
    expect(state.audits).toHaveLength(1);

    await expect(
      finalizePublication(
        { workflowId: state.workflowId, aggregateVersion: 5 },
        state.dependencies,
      ),
    ).resolves.toMatchObject({ status: "ALREADY_PUBLISHED", publicationId: state.publicationId });
  });

  it("serves only a committed publication record and supports a bounded byte range", async () => {
    const state = fixture();
    expect(await getPublication(state.transaction)).toBeNull();
    await finalizePublication(
      { workflowId: state.workflowId, aggregateVersion: 5 },
      state.dependencies,
    );
    await expect(getPublication(state.transaction)).resolves.toMatchObject({
      ownerDisplayName: "张三",
      package: { size: state.plaintextZip.length, sha256: sha256(state.plaintextZip) },
    });
    const opened = await openPublicDownload(
      { range: { start: 2, endInclusive: 6 } },
      { transaction: state.transaction, storage: state.storage },
    );
    expect(await collect(opened.body)).toEqual(state.plaintextZip.slice(2, 7));
    expect(opened).toMatchObject({ bytes: 5, totalBytes: state.plaintextZip.length });
  });

  it("never exposes plaintext when the final database transaction fails", async () => {
    const state = fixture();
    let runs = 0;
    await expect(
      finalizePublication(
        { workflowId: state.workflowId, aggregateVersion: 5 },
        {
          ...state.dependencies,
          transaction: {
            run: async <T>(work: (tx: TransactionContext) => Promise<T>) => {
              runs += 1;
              if (runs === 2) throw new Error("database unavailable");
              return state.transaction.run(work);
            },
          },
        },
      ),
    ).rejects.toThrow("database unavailable");
    expect([...state.storage.objects.keys()].some((key) => key.startsWith("staging:"))).toBe(false);
    expect([...state.storage.objects.keys()].some((key) => key.startsWith("public:"))).toBe(false);
    expect(state.tables.get("publications")).toHaveLength(0);
    await expect(getPublication(state.transaction)).resolves.toBeNull();
  });

  it("keeps committed staging recoverable until a retry promotes it publicly", async () => {
    const state = fixture();
    await expect(
      finalizePublication(
        { workflowId: state.workflowId, aggregateVersion: 5 },
        {
          ...state.dependencies,
          fault: async (point: string) => {
            if (point === "BEFORE_PUBLIC_PROMOTION") throw new Error("worker crashed after commit");
          },
        },
      ),
    ).rejects.toThrow("worker crashed after commit");
    expect(state.tables.get("publications")).toHaveLength(1);
    expect([...state.storage.objects.keys()].some((key) => key.startsWith("staging:"))).toBe(true);
    expect([...state.storage.objects.keys()].some((key) => key.startsWith("public:"))).toBe(false);

    await expect(
      finalizePublication(
        { workflowId: state.workflowId, aggregateVersion: 5 },
        state.dependencies,
      ),
    ).resolves.toMatchObject({ status: "ALREADY_PUBLISHED" });
    expect([...state.storage.objects.keys()].some((key) => key.startsWith("staging:"))).toBe(false);
    expect([...state.storage.objects.keys()].some((key) => key.startsWith("public:"))).toBe(true);
  });
});
