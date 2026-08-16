import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type {
  ObjectMetadata,
  ObjectNamespace,
  ObjectStoragePort,
} from "../../packages/application/src/ports/object-storage.js";
import type { TransactionContext } from "../../packages/application/src/ports/transaction-manager.js";
import {
  finalizePublication,
  PUBLICATION_FAULT_POINTS,
  type PublicationFaultPoint,
} from "../../packages/application/src/publication/finalize-publication.js";

type Row = Record<string, unknown>;

function digest(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

async function collect(body: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of body) chunks.push(new Uint8Array(chunk));
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}

class FaultStorage implements ObjectStoragePort {
  public objects = new Map<string, Uint8Array>();
  public failHead = false;

  public async put(input: {
    namespace: ObjectNamespace;
    key: string;
    body: AsyncIterable<Uint8Array>;
    expectedBytes?: number;
    expectedSha256?: string;
  }): Promise<ObjectMetadata> {
    const body = await collect(input.body);
    const sha256 = digest(body);
    if (input.expectedBytes !== undefined && input.expectedBytes !== body.length)
      throw new Error("size mismatch");
    if (input.expectedSha256 !== undefined && input.expectedSha256 !== sha256)
      throw new Error("digest mismatch");
    this.objects.set(`${input.namespace}:${input.key}`, body);
    return { bytes: body.length, sha256, etag: sha256 };
  }

  public async head(namespace: ObjectNamespace, key: string): Promise<ObjectMetadata | null> {
    if (this.failHead) throw new Error("storage unavailable");
    const body = this.objects.get(`${namespace}:${key}`);
    return body === undefined
      ? null
      : { bytes: body.length, sha256: digest(body), etag: digest(body) };
  }

  public async read(
    namespace: ObjectNamespace,
    key: string,
    range?: { start: number; endInclusive?: number },
  ) {
    const body = this.objects.get(`${namespace}:${key}`);
    if (body === undefined) throw new Error("object missing");
    const start = range?.start ?? 0;
    const end = range?.endInclusive ?? body.length - 1;
    return {
      body: (async function* () {
        yield body.slice(start, end + 1);
      })(),
      bytes: end - start + 1,
      totalBytes: body.length,
      etag: digest(body),
    };
  }

  public async promote(input: {
    from: "staging";
    to: "private" | "public";
    sourceKey: string;
    destinationKey: string;
    expectedSha256: string;
  }): Promise<void> {
    const source = this.objects.get(`staging:${input.sourceKey}`);
    if (source === undefined || digest(source) !== input.expectedSha256)
      throw new Error("promotion source mismatch");
    const destination = `${input.to}:${input.destinationKey}`;
    const existing = this.objects.get(destination);
    if (existing !== undefined && digest(existing) !== input.expectedSha256) {
      throw new Error("public object conflict");
    }
    this.objects.set(destination, source);
    this.objects.delete(`staging:${input.sourceKey}`);
  }

  public async delete(namespace: "private" | "staging", key: string): Promise<void> {
    this.objects.delete(`${namespace}:${key}`);
  }
}

function createFixture() {
  const ids = {
    workflow: "00000000-0000-4000-8000-000000000901",
    package: "00000000-0000-4000-8000-000000000902",
    publication: "00000000-0000-4000-8000-000000000903",
    generation: "00000000-0000-4000-8000-000000000904",
    vault: "00000000-0000-4000-8000-000000000905",
    session: "00000000-0000-4000-8000-000000000906",
    contact: "00000000-0000-4000-8000-000000000907",
  } as const;
  const ciphertext = new TextEncoder().encode("authenticated encrypted package");
  const plaintext = new TextEncoder().encode("validated immutable zip");
  const willBytes = new TextEncoder().encode("# 最后的话");
  let tables = new Map<string, Row[]>([
    [
      "workflows",
      [
        {
          id: ids.workflow,
          kind: "DEATH_CONFIRMATION",
          state: "RELEASE_PENDING",
          share_generation_id: ids.generation,
          package_id: ids.package,
          package_version_snapshot: 9,
          publish_locked_at: "2026-08-09T01:00:00Z",
          contact_count_snapshot: 1,
          required_count_snapshot: 1,
          approved_count: 1,
          owner_display_name_snapshot_ciphertext: new TextEncoder().encode("张三"),
          owner_display_name_snapshot_nonce: new Uint8Array(12),
          owner_display_name_snapshot_key_version: 1,
          version: 4,
        },
      ],
    ],
    ["shareGenerations", [{ id: ids.generation, vault_id: ids.vault, version: 0 }]],
    ["vaults", [{ id: ids.vault, version: 0 }]],
    [
      "packages",
      [
        {
          id: ids.package,
          status: "ACTIVE",
          version_no: 9,
          object_key: "private-object",
          ciphertext_size: ciphertext.length,
          ciphertext_sha256: Buffer.from(digest(ciphertext), "hex"),
          version: 0,
        },
      ],
    ],
    [
      "releaseSecretSessions",
      [
        {
          id: ids.session,
          workflow_id: ids.workflow,
          status: "ACTIVE",
          stage_key_envelope: new Uint8Array(48),
          stage_key_nonce: new Uint8Array(24),
          stage_key_version: 1,
          version: 0,
        },
      ],
    ],
    ["workflowContacts", [{ workflow_id: ids.workflow, contact_id: ids.contact, version: 0 }]],
    ["publications", []],
    ["publicEvents", []],
  ]);
  let outbox: Row[] = [];
  let audits: Row[] = [];

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
    async updateVersioned(id: unknown, expectedVersion: number, patch: Row) {
      const row = tables.get(name)?.find((candidate) => candidate.id === id);
      if (row === undefined || Number(row.version) !== expectedVersion)
        throw new Error("database version conflict");
      Object.assign(row, patch, { version: expectedVersion + 1 });
      return row;
    },
  });
  const context = () =>
    ({
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
      clock: { now: async () => "2026-08-09T04:00:00Z" },
      outbox: {
        enqueue: async (event: Row) => {
          outbox.push(event);
          return event;
        },
      },
      audit: { append: async (event: Row) => void audits.push(event) },
    }) as unknown as TransactionContext;
  let transactionRuns = 0;
  let failTransactionRun: number | undefined;
  const transaction = {
    run: async <T>(work: (tx: TransactionContext) => Promise<T>) => {
      transactionRuns += 1;
      if (transactionRuns === failTransactionRun) throw new Error("database unavailable");
      const tableSnapshot = structuredClone(tables);
      const outboxSnapshot = structuredClone(outbox);
      const auditSnapshot = structuredClone(audits);
      try {
        return await work(context());
      } catch (error) {
        tables = tableSnapshot;
        outbox = outboxSnapshot;
        audits = auditSnapshot;
        throw error;
      }
    },
  };
  const storage = new FaultStorage();
  storage.objects.set("private:private-object", ciphertext);
  let decryptMode: "ok" | "truncated" = "ok";
  let archiveMode: "ok" | "bad" | "missing-will" = "ok";
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
        await onChunk(plaintext.slice(0, 5));
        if (decryptMode === "truncated") throw new Error("secretstream truncated");
        await onChunk(plaintext.slice(5));
        return { plaintextBytes: plaintext.length, frameCount: 2 };
      },
    },
    archiveInspector: {
      inspect: async () => {
        if (archiveMode === "bad") throw new Error("bad ZIP");
        if (archiveMode === "missing-will") throw new Error("will.md missing");
        return {
          archiveBytes: plaintext.length,
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
            sha256: digest(willBytes),
            body: (async function* () {
              yield willBytes;
            })(),
          },
        };
      },
    },
    willRenderer: (source: string) => ({
      html: `<h1>${source.slice(2)}</h1>`,
      sourceSha256: digest(new TextEncoder().encode(source)),
    }),
    ownerDisplayName: async ({ ciphertext: value }: { ciphertext: Uint8Array }) =>
      new TextDecoder().decode(value),
    idFactory: () => ids.publication,
  };
  return {
    ids,
    plaintext,
    storage,
    dependencies,
    publications: () => tables.get("publications") ?? [],
    publicEvents: () => tables.get("publicEvents") ?? [],
    outbox: () => outbox,
    setDecryptMode: (value: typeof decryptMode) => {
      decryptMode = value;
    },
    setArchiveMode: (value: typeof archiveMode) => {
      archiveMode = value;
    },
    failFinalTransaction: () => {
      failTransactionRun = 2;
    },
  };
}

describe("publication crash matrix contract", () => {
  it("enumerates every irreversible pipeline boundary for deterministic fault injection", () => {
    expect(PUBLICATION_FAULT_POINTS).toEqual([
      "BEFORE_STAGE_VK_UNWRAP",
      "AFTER_STAGE_VK_UNWRAP",
      "BEFORE_DEK_UNWRAP",
      "AFTER_DEK_UNWRAP",
      "BEFORE_SECRETSTREAM_CHUNK",
      "AFTER_SECRETSTREAM_CHUNK",
      "BEFORE_ZIP_VALIDATION",
      "AFTER_ZIP_VALIDATION",
      "BEFORE_WILL_RENDER",
      "AFTER_WILL_RENDER",
      "BEFORE_DB_TRANSACTION",
      "BEFORE_PUBLIC_AUDIT_APPEND",
      "AFTER_PUBLIC_AUDIT_APPEND",
      "BEFORE_NOTIFICATION_OUTBOX",
      "AFTER_NOTIFICATION_OUTBOX",
      "AFTER_DB_TRANSACTION",
      "BEFORE_PUBLIC_PROMOTION",
      "AFTER_PUBLIC_PROMOTION",
    ]);
  });

  it.each(PUBLICATION_FAULT_POINTS)("recovers deterministically from %s", async (point) => {
    const state = createFixture();
    await expect(
      finalizePublication(
        { workflowId: state.ids.workflow, aggregateVersion: 4 },
        {
          ...state.dependencies,
          fault: async (candidate: PublicationFaultPoint) => {
            if (candidate === point) throw new Error(`crash:${point}`);
          },
        },
      ),
    ).rejects.toThrow(`crash:${point}`);
    const committedPoints: readonly PublicationFaultPoint[] = [
      "AFTER_DB_TRANSACTION",
      "BEFORE_PUBLIC_PROMOTION",
      "AFTER_PUBLIC_PROMOTION",
    ];
    const committed = committedPoints.includes(point);
    const staged = [...state.storage.objects.keys()].some((key) => key.startsWith("staging:"));
    const publiclyReadable = [...state.storage.objects.keys()].some((key) =>
      key.startsWith("public:"),
    );
    if (committed) {
      expect(state.publications()).toHaveLength(1);
      expect(state.publicEvents()).toHaveLength(5);
      expect(state.outbox()).toHaveLength(1);
    } else {
      expect(state.publications()).toHaveLength(0);
      expect(state.publicEvents()).toHaveLength(0);
      expect(state.outbox()).toHaveLength(0);
    }
    expect(publiclyReadable).toBe(point === "AFTER_PUBLIC_PROMOTION");
    expect(staged).toBe(point === "AFTER_DB_TRANSACTION" || point === "BEFORE_PUBLIC_PROMOTION");
    await expect(
      finalizePublication(
        { workflowId: state.ids.workflow, aggregateVersion: 4 },
        state.dependencies,
      ),
    ).resolves.toMatchObject({
      status: committed ? "ALREADY_PUBLISHED" : "PUBLISHED",
    });
    expect([...state.storage.objects.keys()].some((key) => key.startsWith("public:"))).toBe(true);
  });

  it("rejects tampering, truncation, invalid archives, object conflicts, and outages", async () => {
    const tampered = createFixture();
    tampered.storage.objects.set(
      "private:private-object",
      new TextEncoder().encode("tampered ciphertext"),
    );
    await expect(
      finalizePublication(
        { workflowId: tampered.ids.workflow, aggregateVersion: 4 },
        tampered.dependencies,
      ),
    ).rejects.toThrow("integrity check failed");

    const truncated = createFixture();
    truncated.setDecryptMode("truncated");
    await expect(
      finalizePublication(
        { workflowId: truncated.ids.workflow, aggregateVersion: 4 },
        truncated.dependencies,
      ),
    ).rejects.toThrow("secretstream truncated");

    const wrongDek = createFixture();
    await expect(
      finalizePublication(
        { workflowId: wrongDek.ids.workflow, aggregateVersion: 4 },
        {
          ...wrongDek.dependencies,
          cryptography: {
            ...wrongDek.dependencies.cryptography,
            unwrapPackageDek: async () => {
              throw new Error("wrong DEK authentication failed");
            },
          },
        },
      ),
    ).rejects.toThrow("wrong DEK authentication failed");

    for (const mode of ["bad", "missing-will"] as const) {
      const invalid = createFixture();
      invalid.setArchiveMode(mode);
      await expect(
        finalizePublication(
          { workflowId: invalid.ids.workflow, aggregateVersion: 4 },
          invalid.dependencies,
        ),
      ).rejects.toThrow(mode === "bad" ? "bad ZIP" : "will.md missing");
    }

    const conflict = createFixture();
    const plaintextSha = digest(conflict.plaintext);
    conflict.storage.objects.set(
      `public:legacy/${plaintextSha.slice(0, 2)}/${plaintextSha}.zip`,
      new TextEncoder().encode("different public bytes"),
    );
    await expect(
      finalizePublication(
        { workflowId: conflict.ids.workflow, aggregateVersion: 4 },
        conflict.dependencies,
      ),
    ).rejects.toThrow("public object conflict");

    const storageOutage = createFixture();
    storageOutage.storage.failHead = true;
    await expect(
      finalizePublication(
        { workflowId: storageOutage.ids.workflow, aggregateVersion: 4 },
        storageOutage.dependencies,
      ),
    ).rejects.toThrow("storage unavailable");

    const databaseOutage = createFixture();
    databaseOutage.failFinalTransaction();
    await expect(
      finalizePublication(
        { workflowId: databaseOutage.ids.workflow, aggregateVersion: 4 },
        databaseOutage.dependencies,
      ),
    ).rejects.toThrow("database unavailable");
    expect(databaseOutage.publications()).toHaveLength(0);
    expect(
      [...databaseOutage.storage.objects.keys()].some((key) => key.startsWith("public:")),
    ).toBe(false);
  });
});
