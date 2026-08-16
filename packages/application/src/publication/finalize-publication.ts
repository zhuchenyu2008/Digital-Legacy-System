import { createHash, randomUUID } from "node:crypto";
import { hashAuditEvent } from "../audit/canonical-event.js";
import type { ArchiveInspectorPort } from "../ports/archive-inspector.js";
import type { ObjectStoragePort } from "../ports/object-storage.js";
import type { RepositoryInput, RepositoryRow, VersionedRepository } from "../ports/repositories.js";
import type { StageKeyProvider } from "../ports/stage-key-provider.js";
import type { TransactionManager } from "../ports/transaction-manager.js";

export const PUBLICATION_FAULT_POINTS = [
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
] as const;

export type PublicationFaultPoint = (typeof PUBLICATION_FAULT_POINTS)[number];

export class PublicationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 409,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "PublicationError";
  }
}

export interface PublicationCryptography {
  unwrapReleaseVaultKey(
    input: Readonly<{
      workflow: RepositoryRow;
      generation: RepositoryRow;
      vault: RepositoryRow;
      session: RepositoryRow;
      stageKey: Uint8Array;
    }>,
  ): Promise<Uint8Array>;
  unwrapPackageDek(
    input: Readonly<{
      package: RepositoryRow;
      vault: RepositoryRow;
      vaultKey: Uint8Array;
    }>,
  ): Promise<Uint8Array>;
  decryptPackage(
    input: Readonly<{
      package: RepositoryRow;
      vault: RepositoryRow;
      dek: Uint8Array;
      ciphertext: AsyncIterable<Uint8Array>;
      onChunk(chunk: Uint8Array): Promise<void>;
    }>,
  ): Promise<Readonly<{ plaintextBytes: number; frameCount: number }>>;
}

type WillRenderResult = Readonly<{ html: string; sourceSha256: string }>;

export type FinalizePublicationDependencies = Readonly<{
  transaction: TransactionManager;
  storage: ObjectStoragePort;
  stageKeys: StageKeyProvider;
  cryptography: PublicationCryptography;
  archiveInspector: ArchiveInspectorPort;
  willRenderer(source: string): WillRenderResult;
  ownerDisplayName(
    snapshot: Readonly<{
      ciphertext: Uint8Array;
      nonce: Uint8Array;
      keyVersion: number;
    }>,
  ): Promise<string>;
  idFactory?: () => string;
  maxPlaintextBytes?: number;
  maxWillBytes?: number;
  fault?: (point: PublicationFaultPoint) => Promise<void>;
}>;

export type FinalizePublicationResult =
  | Readonly<{ status: "PUBLISHED"; publicationId: string }>
  | Readonly<{ status: "ALREADY_PUBLISHED"; publicationId: string }>;

const ZERO_HASH = new Uint8Array(32);
const DEFAULT_MAX_PLAINTEXT_BYTES = 5 * 1024 * 1024 * 1024;
const DEFAULT_MAX_WILL_BYTES = 2 * 1024 * 1024;

function requiredRepository(
  repository: VersionedRepository | undefined,
  label: string,
): VersionedRepository {
  if (repository === undefined) throw new Error(`${label} repository is unavailable`);
  return repository;
}

function ownedBytes(value: unknown, label: string, exactLength?: number): Uint8Array {
  if (
    !(value instanceof Uint8Array) ||
    (exactLength !== undefined && value.length !== exactLength)
  ) {
    throw new PublicationError("DLS-PUBLICATION-METADATA", `${label} is invalid`, 422);
  }
  return new Uint8Array(value);
}

function positiveInteger(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new PublicationError("DLS-PUBLICATION-METADATA", `${label} is invalid`, 422);
  }
  return parsed;
}

function digestHex(value: unknown, label: string): string {
  if (typeof value === "string" && /^[0-9a-f]{64}$/u.test(value)) return value;
  if (value instanceof Uint8Array && value.length === 32) return Buffer.from(value).toString("hex");
  throw new PublicationError("DLS-PUBLICATION-METADATA", `${label} is invalid`, 422);
}

function publicationStagingKey(workflowId: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(workflowId)) {
    throw new PublicationError("DLS-PUBLICATION-METADATA", "workflow ID is invalid", 422);
  }
  return `${workflowId.slice(0, 2)}/${workflowId.slice(2, 4)}/${workflowId}`;
}

async function promoteCommittedPublication(
  publication: RepositoryRow,
  stagingKey: string,
  storage: ObjectStoragePort,
): Promise<void> {
  const publicObjectKey = String(publication.public_object_key);
  const expectedBytes = positiveInteger(publication.zip_size, "publication ZIP size");
  const expectedSha256 = digestHex(publication.zip_sha256, "publication ZIP digest");
  const existing = await storage.head("public", publicObjectKey);
  if (existing !== null) {
    if (existing.bytes !== expectedBytes || existing.sha256 !== expectedSha256) {
      throw new PublicationError(
        "DLS-PUBLICATION-PROMOTION",
        "committed public object conflicts with publication metadata",
        503,
      );
    }
    await storage.delete("staging", stagingKey).catch(() => undefined);
    return;
  }
  const staged = await storage.head("staging", stagingKey);
  if (staged === null || staged.bytes !== expectedBytes || staged.sha256 !== expectedSha256) {
    throw new PublicationError(
      "DLS-PUBLICATION-PROMOTION",
      "committed publication is awaiting its verified staging object",
      503,
    );
  }
  await storage.promote({
    from: "staging",
    to: "public",
    sourceKey: stagingKey,
    destinationKey: publicObjectKey,
    expectedSha256,
  });
  const promoted = await storage.head("public", publicObjectKey);
  if (promoted === null || promoted.bytes !== expectedBytes || promoted.sha256 !== expectedSha256) {
    throw new PublicationError(
      "DLS-PUBLICATION-PROMOTION",
      "public object integrity check failed",
      503,
    );
  }
}

async function finalizeCommittedPublication(
  command: Readonly<{ workflowId: string }>,
  dependencies: FinalizePublicationDependencies,
): Promise<FinalizePublicationResult> {
  return dependencies.transaction.run(
    async (tx) => {
      const publications = requiredRepository(tx.repositories.publications, "publications");
      const publication = await publications.findOneBy?.("workflow_id", command.workflowId, {
        forUpdate: true,
      });
      if (publication === null || publication === undefined) {
        throw new PublicationError(
          "DLS-PUBLICATION-PROMOTION",
          "publication metadata is unavailable",
          503,
        );
      }
      const workflow = await tx.repositories.workflows.findById(command.workflowId, {
        forUpdate: true,
      });
      if (workflow === null) {
        throw new PublicationError("DLS-PUBLICATION-NOT-FOUND", "workflow was not found", 404);
      }
      if (workflow.state === "RELEASED") {
        return { status: "ALREADY_PUBLISHED", publicationId: String(publication.id) };
      }
      if (
        workflow.kind !== "DEATH_CONFIRMATION" ||
        workflow.state !== "RELEASE_PENDING" ||
        workflow.publish_locked_at === null ||
        workflow.publish_locked_at === undefined
      ) {
        throw new PublicationError("DLS-PUBLICATION-STATE", "workflow is not ready to finalize");
      }
      const now = await tx.clock.now();
      const updated = await tx.repositories.workflows.updateVersioned(
        command.workflowId,
        Number(workflow.version ?? 0),
        { state: "RELEASED", end_reason: "PUBLISHED", ended_at: now },
      );
      const sessions = requiredRepository(
        tx.repositories.releaseSecretSessions,
        "release secret sessions",
      );
      const session = await sessions.findOneBy?.("workflow_id", command.workflowId, {
        forUpdate: true,
      });
      if (session !== null && session !== undefined && session.status === "ACTIVE") {
        await sessions.updateVersioned(String(session.id), Number(session.version ?? 0), {
          status: "CONSUMED",
          stage_key_envelope: null,
          stage_key_nonce: null,
          consumed_at: now,
        });
      }
      await callFault(dependencies, "BEFORE_NOTIFICATION_OUTBOX");
      const workflowContacts = requiredRepository(
        tx.repositories.workflowContacts,
        "workflow contacts",
      );
      const contacts = (await workflowContacts.findMany?.("workflow_id", command.workflowId)) ?? [];
      for (const contact of contacts) {
        const contactId = String(contact.contact_id);
        await tx.outbox.enqueue({
          eventType: "PUBLICATION_RELEASED_NOTIFICATION_REQUESTED",
          aggregateType: "workflow",
          aggregateId: command.workflowId,
          payload: {
            aggregateId: command.workflowId,
            aggregateVersion: Number(updated.version ?? Number(workflow.version ?? 0) + 1),
            contactId,
            publicSlug: "legacy",
          },
          idempotencyKey: `publication-released:${command.workflowId}:${contactId}`,
          availableAt: now,
        });
      }
      await callFault(dependencies, "AFTER_NOTIFICATION_OUTBOX");
      await tx.audit.append({
        eventId: dependencies.idFactory?.() ?? randomUUID(),
        occurredAt: now,
        eventType: "DIGITAL_LEGACY_PUBLISHED",
        actorType: "SYSTEM",
        aggregateType: "workflow",
        aggregateId: command.workflowId,
        result: "SUCCESS",
        metadata: {
          publicationId: String(publication.id),
          zipSha256: digestHex(publication.zip_sha256, "publication ZIP digest"),
        },
      });
      return { status: "PUBLISHED", publicationId: String(publication.id) };
    },
    { isolation: "serializable" },
  );
}

function assertWorkflowAndPackage(
  workflow: RepositoryRow,
  packageRow: RepositoryRow,
  aggregateVersion: number,
): void {
  if (
    workflow.kind !== "DEATH_CONFIRMATION" ||
    workflow.state !== "RELEASE_PENDING" ||
    workflow.publish_locked_at === null ||
    workflow.publish_locked_at === undefined
  ) {
    throw new PublicationError("DLS-PUBLICATION-STATE", "workflow is not publication-locked");
  }
  if (Number(workflow.version) !== aggregateVersion) {
    throw new PublicationError("DLS-PUBLICATION-VERSION", "workflow version is stale");
  }
  if (
    packageRow.status !== "ACTIVE" ||
    String(packageRow.id) !== String(workflow.package_id) ||
    Number(packageRow.version_no) !== Number(workflow.package_version_snapshot)
  ) {
    throw new PublicationError("DLS-PUBLICATION-PACKAGE", "package snapshot is unavailable");
  }
}

class PlaintextPipe implements AsyncIterable<Uint8Array> {
  readonly #queue: Array<{
    chunk: Uint8Array;
    resolve: () => void;
    reject: (reason?: unknown) => void;
  }> = [];
  readonly #waiters: Array<{
    resolve: (value: IteratorResult<Uint8Array>) => void;
    reject: (reason?: unknown) => void;
  }> = [];
  #ended = false;
  #error: unknown;

  async push(chunk: Uint8Array): Promise<void> {
    if (this.#ended) throw new Error("plaintext pipe is closed");
    const waiter = this.#waiters.shift();
    if (waiter !== undefined) {
      waiter.resolve({ done: false, value: chunk });
      return;
    }
    await new Promise<void>((resolve, reject) => {
      this.#queue.push({ chunk, resolve, reject });
    });
  }

  end(): void {
    if (this.#ended) return;
    this.#ended = true;
    for (const waiter of this.#waiters.splice(0)) waiter.resolve({ done: true, value: undefined });
  }

  fail(error: unknown): void {
    if (this.#ended) return;
    this.#ended = true;
    this.#error = error;
    for (const queued of this.#queue.splice(0)) queued.reject(error);
    for (const waiter of this.#waiters.splice(0)) waiter.reject(error);
  }

  [Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
    return {
      next: async () => {
        const queued = this.#queue.shift();
        if (queued !== undefined) {
          queued.resolve();
          return { done: false, value: queued.chunk };
        }
        if (this.#error !== undefined) throw this.#error;
        if (this.#ended) return { done: true, value: undefined };
        return new Promise<IteratorResult<Uint8Array>>((resolve, reject) => {
          this.#waiters.push({ resolve, reject });
        });
      },
    };
  }
}

async function readUtf8(
  body: AsyncIterable<Uint8Array>,
  expectedBytes: number,
  maxBytes: number,
): Promise<{ source: string; sha256: string }> {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const hash = createHash("sha256");
  let source = "";
  let bytes = 0;
  for await (const chunk of body) {
    bytes += chunk.length;
    if (bytes > maxBytes)
      throw new PublicationError("DLS-PUBLICATION-WILL", "will.md is too large", 422);
    hash.update(chunk);
    source += decoder.decode(chunk, { stream: true });
  }
  source += decoder.decode();
  if (bytes !== expectedBytes) {
    throw new PublicationError(
      "DLS-PUBLICATION-WILL",
      "will.md size does not match the archive",
      422,
    );
  }
  return { source, sha256: hash.digest("hex") };
}

async function callFault(
  dependencies: FinalizePublicationDependencies,
  point: PublicationFaultPoint,
): Promise<void> {
  await dependencies.fault?.(point);
}

function publicAuditRows(
  input: Readonly<{
    publicationId: string;
    occurredAt: string;
    workflow: RepositoryRow;
    zipSha256: string;
  }>,
): readonly RepositoryInput[] {
  const events = [
    { code: "WORKFLOW_TRIGGERED", message: "遗产发布流程已启动。", metadata: { stage: "STARTED" } },
    {
      code: "CONFIRMATION_PROGRESS",
      message: "联系人确认已完成。",
      metadata: {
        contactCount: Number(input.workflow.contact_count_snapshot),
        approvedCount: Number(input.workflow.approved_count),
      },
    },
    {
      code: "THRESHOLD_REACHED",
      message: "发布确认阈值已达到。",
      metadata: { threshold: Number(input.workflow.required_count_snapshot) },
    },
    {
      code: "PUBLICATION_LOCKED",
      message: "发布内容已锁定。",
      metadata: { packageVersion: Number(input.workflow.package_version_snapshot) },
    },
    {
      code: "PUBLICATION_COMPLETE",
      message: "数字遗产已完成不可变发布。",
      metadata: { zipSha256: input.zipSha256 },
    },
  ] as const;
  let previousHash: Uint8Array = new Uint8Array(ZERO_HASH);
  return events.map((event, index) => {
    const sequence = index + 1;
    const eventHash = hashAuditEvent({
      sequence,
      occurredAt: input.occurredAt,
      eventType: event.code,
      actorType: "PUBLIC",
      actorIdDigest: ZERO_HASH,
      aggregateType: "publication",
      aggregateId: input.publicationId,
      payload: { message: event.message, metadata: event.metadata },
      previousHash,
    });
    const row = {
      publication_id: input.publicationId,
      sequence_no: sequence,
      occurred_at: input.occurredAt,
      event_code: event.code,
      public_message: event.message,
      public_metadata: event.metadata,
      previous_hash: previousHash,
      event_hash: eventHash,
    } as const;
    previousHash = eventHash;
    return row;
  });
}

export async function finalizePublication(
  command: Readonly<{ workflowId: string; aggregateVersion: number }>,
  dependencies: FinalizePublicationDependencies,
): Promise<FinalizePublicationResult> {
  const initial = await dependencies.transaction.run(async (tx) => {
    const publications = requiredRepository(tx.repositories.publications, "publications");
    const existing = await publications.findOneBy?.("workflow_id", command.workflowId);
    if (existing !== null && existing !== undefined) {
      return { existingPublicationId: String(existing.id), existingPublication: existing } as const;
    }
    const workflow = await tx.repositories.workflows.findById(command.workflowId, {
      forUpdate: true,
    });
    if (workflow === null)
      throw new PublicationError("DLS-PUBLICATION-NOT-FOUND", "workflow was not found", 404);
    const packageRow = await tx.repositories.packages.findById(String(workflow.package_id), {
      forUpdate: true,
    });
    if (packageRow === null)
      throw new PublicationError("DLS-PUBLICATION-PACKAGE", "package was not found");
    assertWorkflowAndPackage(workflow, packageRow, command.aggregateVersion);
    const generation = await requiredRepository(
      tx.repositories.shareGenerations,
      "share generations",
    ).findById(String(workflow.share_generation_id), { forUpdate: true });
    if (generation === null)
      throw new PublicationError("DLS-PUBLICATION-KEY", "share generation was not found");
    const vault = await tx.repositories.vaults.findById(String(generation.vault_id), {
      forUpdate: true,
    });
    if (vault === null) throw new PublicationError("DLS-PUBLICATION-KEY", "vault was not found");
    const sessions = requiredRepository(
      tx.repositories.releaseSecretSessions,
      "release secret sessions",
    );
    const session = await sessions.findOneBy?.("workflow_id", command.workflowId, {
      forUpdate: true,
    });
    if (session === null || session === undefined || session.status !== "ACTIVE") {
      throw new PublicationError(
        "DLS-PUBLICATION-KEY",
        "active release secret session was not found",
      );
    }
    return { workflow, packageRow, generation, vault, session } as const;
  });
  const stagingKey = publicationStagingKey(command.workflowId);
  if ("existingPublicationId" in initial) {
    if (initial.existingPublication === undefined) {
      throw new PublicationError(
        "DLS-PUBLICATION-PROMOTION",
        "committed publication metadata is unavailable",
        503,
      );
    }
    await promoteCommittedPublication(
      initial.existingPublication,
      stagingKey,
      dependencies.storage,
    );
    const finalized = await finalizeCommittedPublication(
      { workflowId: command.workflowId },
      dependencies,
    );
    return finalized.status === "PUBLISHED"
      ? { status: "ALREADY_PUBLISHED", publicationId: initial.existingPublicationId }
      : finalized;
  }

  const ownerCiphertext = ownedBytes(
    initial.workflow.owner_display_name_snapshot_ciphertext,
    "owner display name snapshot ciphertext",
  );
  const ownerNonce = ownedBytes(
    initial.workflow.owner_display_name_snapshot_nonce,
    "owner display name snapshot nonce",
  );
  const ownerDisplayName = await dependencies.ownerDisplayName({
    ciphertext: ownerCiphertext,
    nonce: ownerNonce,
    keyVersion: positiveInteger(
      initial.workflow.owner_display_name_snapshot_key_version,
      "owner display name snapshot key version",
    ),
  });
  const stageVersion = positiveInteger(
    initial.session.stage_key_version,
    "release stage key version",
  );
  const suppliedStage =
    dependencies.stageKeys.stageKey === undefined
      ? await dependencies.stageKeys.currentStageKey("DEATH")
      : await dependencies.stageKeys.stageKey("DEATH", stageVersion);
  const stageKey = ownedBytes(suppliedStage.key, "release stage key", 32);
  if (suppliedStage.version !== stageVersion) {
    stageKey.fill(0);
    throw new PublicationError(
      "DLS-PUBLICATION-KEY",
      "release stage key version does not match",
      503,
    );
  }

  let vaultKey: Uint8Array | undefined;
  let dek: Uint8Array | undefined;
  let databaseCommitted = false;
  try {
    await callFault(dependencies, "BEFORE_STAGE_VK_UNWRAP");
    vaultKey = await dependencies.cryptography.unwrapReleaseVaultKey({
      workflow: initial.workflow,
      generation: initial.generation,
      vault: initial.vault,
      session: initial.session,
      stageKey,
    });
    if (!(vaultKey instanceof Uint8Array) || vaultKey.length !== 32) {
      throw new PublicationError("DLS-PUBLICATION-KEY", "unwrapped vault key is invalid", 422);
    }
    await callFault(dependencies, "AFTER_STAGE_VK_UNWRAP");
    await callFault(dependencies, "BEFORE_DEK_UNWRAP");
    dek = await dependencies.cryptography.unwrapPackageDek({
      package: initial.packageRow,
      vault: initial.vault,
      vaultKey,
    });
    if (!(dek instanceof Uint8Array) || dek.length !== 32) {
      throw new PublicationError("DLS-PUBLICATION-KEY", "unwrapped package key is invalid", 422);
    }
    await callFault(dependencies, "AFTER_DEK_UNWRAP");

    const objectKey = String(initial.packageRow.object_key);
    const ciphertextBytes = positiveInteger(initial.packageRow.ciphertext_size, "ciphertext size");
    const ciphertextSha256 = digestHex(initial.packageRow.ciphertext_sha256, "ciphertext digest");
    const privateMetadata = await dependencies.storage.head("private", objectKey);
    if (
      privateMetadata === null ||
      privateMetadata.bytes !== ciphertextBytes ||
      privateMetadata.sha256 !== ciphertextSha256
    ) {
      throw new PublicationError(
        "DLS-PUBLICATION-CIPHERTEXT",
        "private ciphertext integrity check failed",
        422,
      );
    }
    const encrypted = await dependencies.storage.read("private", objectKey);
    const pipe = new PlaintextPipe();
    const stored = dependencies.storage
      .put({ namespace: "staging", key: stagingKey, body: pipe })
      .catch((error: unknown) => {
        pipe.fail(error);
        throw error;
      });
    void stored.catch(() => undefined);
    const plaintextHash = createHash("sha256");
    let plaintextBytes = 0;
    try {
      const decrypted = await dependencies.cryptography.decryptPackage({
        package: initial.packageRow,
        vault: initial.vault,
        dek,
        ciphertext: encrypted.body,
        onChunk: async (chunk) => {
          await callFault(dependencies, "BEFORE_SECRETSTREAM_CHUNK");
          plaintextBytes += chunk.length;
          if (plaintextBytes > (dependencies.maxPlaintextBytes ?? DEFAULT_MAX_PLAINTEXT_BYTES)) {
            throw new PublicationError(
              "DLS-PUBLICATION-SIZE",
              "plaintext package exceeds the byte budget",
              422,
            );
          }
          plaintextHash.update(chunk);
          await pipe.push(new Uint8Array(chunk));
          await callFault(dependencies, "AFTER_SECRETSTREAM_CHUNK");
        },
      });
      if (decrypted.plaintextBytes !== plaintextBytes || decrypted.frameCount < 1) {
        throw new PublicationError(
          "DLS-PUBLICATION-PLAINTEXT",
          "secretstream manifest does not match emitted plaintext",
          422,
        );
      }
      pipe.end();
    } catch (error) {
      pipe.fail(error);
      await stored.catch(() => undefined);
      throw error;
    }
    const stagedMetadata = await stored;
    const zipSha256 = plaintextHash.digest("hex");
    if (stagedMetadata.bytes !== plaintextBytes || stagedMetadata.sha256 !== zipSha256) {
      throw new PublicationError(
        "DLS-PUBLICATION-PLAINTEXT",
        "staged plaintext integrity check failed",
        422,
      );
    }

    await callFault(dependencies, "BEFORE_ZIP_VALIDATION");
    const stagedArchive = await dependencies.storage.read("staging", stagingKey);
    const inspection = await dependencies.archiveInspector.inspect(stagedArchive.body, {
      maxArchiveBytes: dependencies.maxPlaintextBytes ?? DEFAULT_MAX_PLAINTEXT_BYTES,
      maxWillBytes: dependencies.maxWillBytes ?? DEFAULT_MAX_WILL_BYTES,
    });
    if (inspection.archiveBytes !== plaintextBytes) {
      throw new PublicationError(
        "DLS-PUBLICATION-ZIP",
        "validated ZIP size does not match plaintext",
        422,
      );
    }
    await callFault(dependencies, "AFTER_ZIP_VALIDATION");
    const will = await readUtf8(
      inspection.will.body,
      inspection.will.bytes,
      dependencies.maxWillBytes ?? DEFAULT_MAX_WILL_BYTES,
    );
    if (will.sha256 !== inspection.will.sha256) {
      throw new PublicationError(
        "DLS-PUBLICATION-WILL",
        "will.md digest does not match the archive",
        422,
      );
    }
    await callFault(dependencies, "BEFORE_WILL_RENDER");
    const rendered = dependencies.willRenderer(will.source);
    if (rendered.sourceSha256 !== will.sha256 || rendered.html.trim() === "") {
      throw new PublicationError(
        "DLS-PUBLICATION-WILL",
        "rendered will integrity check failed",
        422,
      );
    }
    await callFault(dependencies, "AFTER_WILL_RENDER");

    const publicObjectKey = `legacy/${zipSha256.slice(0, 2)}/${zipSha256}.zip`;
    await callFault(dependencies, "BEFORE_DB_TRANSACTION");

    const publicationId = dependencies.idFactory?.() ?? randomUUID();
    const committed = await dependencies.transaction.run(
      async (
        tx,
      ): Promise<Readonly<{ result: FinalizePublicationResult; publication: RepositoryRow }>> => {
        const publications = requiredRepository(tx.repositories.publications, "publications");
        const existing = await publications.findOneBy?.("workflow_id", command.workflowId, {
          forUpdate: true,
        });
        if (existing !== null && existing !== undefined) {
          return {
            result: { status: "ALREADY_PUBLISHED", publicationId: String(existing.id) },
            publication: existing,
          };
        }
        const workflow = await tx.repositories.workflows.findById(command.workflowId, {
          forUpdate: true,
        });
        if (workflow === null)
          throw new PublicationError("DLS-PUBLICATION-NOT-FOUND", "workflow was not found", 404);
        const packageRow = await tx.repositories.packages.findById(String(workflow.package_id), {
          forUpdate: true,
        });
        if (packageRow === null)
          throw new PublicationError("DLS-PUBLICATION-PACKAGE", "package was not found");
        assertWorkflowAndPackage(workflow, packageRow, command.aggregateVersion);
        const sessions = requiredRepository(
          tx.repositories.releaseSecretSessions,
          "release secret sessions",
        );
        const session = await sessions.findOneBy?.("workflow_id", command.workflowId, {
          forUpdate: true,
        });
        if (session === null || session === undefined || session.status !== "ACTIVE") {
          throw new PublicationError(
            "DLS-PUBLICATION-KEY",
            "active release secret session was not found",
          );
        }
        const now = await tx.clock.now();
        const events = publicAuditRows({ publicationId, occurredAt: now, workflow, zipSha256 });
        const finalHash = ownedBytes(events.at(-1)?.event_hash, "public audit final hash", 32);
        const publication = await publications.insert({
          id: publicationId,
          workflow_id: command.workflowId,
          package_id: String(packageRow.id),
          public_slug: "legacy",
          public_object_key: publicObjectKey,
          owner_display_name: ownerDisplayName,
          zip_size: plaintextBytes,
          zip_sha256: Buffer.from(zipSha256, "hex"),
          will_markdown_sha256: Buffer.from(will.sha256, "hex"),
          will_html_sanitized: rendered.html,
          public_audit_final_hash: finalHash,
          published_at: now,
          visible_at: now,
        });
        await callFault(dependencies, "BEFORE_PUBLIC_AUDIT_APPEND");
        const publicEvents = requiredRepository(tx.repositories.publicEvents, "public events");
        for (const event of events) await publicEvents.insert(event);
        await callFault(dependencies, "AFTER_PUBLIC_AUDIT_APPEND");
        await callFault(dependencies, "BEFORE_NOTIFICATION_OUTBOX");
        await callFault(dependencies, "AFTER_NOTIFICATION_OUTBOX");
        return { result: { status: "PUBLISHED", publicationId }, publication };
      },
      { isolation: "serializable" },
    );
    databaseCommitted = true;
    await callFault(dependencies, "AFTER_DB_TRANSACTION");
    await callFault(dependencies, "BEFORE_PUBLIC_PROMOTION");
    await promoteCommittedPublication(committed.publication, stagingKey, dependencies.storage);
    await callFault(dependencies, "AFTER_PUBLIC_PROMOTION");
    await finalizeCommittedPublication({ workflowId: command.workflowId }, dependencies);
    return committed.result;
  } finally {
    stageKey.fill(0);
    vaultKey?.fill(0);
    dek?.fill(0);
    ownerCiphertext.fill(0);
    ownerNonce.fill(0);
    if (!databaseCommitted) {
      await dependencies.storage.delete("staging", stagingKey).catch(() => undefined);
    }
  }
}
