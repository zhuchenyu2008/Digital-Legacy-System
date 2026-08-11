type OwnerVaultMaterial = Readonly<{
  vaultId: string;
  activeShareGenerationId?: string;
  nextPackageVersion: number;
  activePackage?: Readonly<{ id: string; versionNo: number; status: string }>;
  ownerVaultEnvelope: Readonly<Record<string, unknown>>;
}>;

export type PreparedEncryptedPackage = Readonly<{
  ciphertext: Blob;
  streamHeader: string;
  ciphertextSize: number;
  ciphertextSha256: string;
  dekEnvelope: string;
  dekEnvelopeNonce: string;
  dekEnvelopeAlgorithm: string;
  dekEnvelopeProtocolVersion: number;
  dekEnvelopeAadHash: string;
  manifestCiphertext: string;
  manifestNonce: string;
  manifestAlgorithm: string;
  manifestAadHash: string;
  clientCryptoVersion: string;
}>;

type Dependencies = Readonly<{
  request<T>(path: string, init?: RequestInit): Promise<T>;
  upload(
    input: Readonly<{
      path: string;
      body: Blob;
      headers: HeadersInit;
      signal?: AbortSignal;
    }>,
  ): Promise<void>;
  prepare(
    input: Readonly<{
      file: File;
      password: string;
      envelope: Readonly<Record<string, unknown>>;
      vaultId: string;
      shareGenerationId: string;
      packageId: string;
      packageVersion: number;
    }>,
  ): Promise<PreparedEncryptedPackage>;
  idFactory?: () => string;
  signal?: AbortSignal;
  onSession?: (session: PackageUploadSessionIdentity) => void;
}>;

export type PackageUploadSessionIdentity = Readonly<{ packageId: string; uploadId: string }>;

function json(value: unknown): string {
  return JSON.stringify(value);
}

function transientUploadError(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted === true || (error as { name?: unknown } | null)?.name === "AbortError") {
    return false;
  }
  const status = Number((error as { status?: unknown } | null)?.status);
  return (
    !Number.isFinite(status) || status === 408 || status === 425 || status === 429 || status >= 500
  );
}

async function uploadWithRetry(
  upload: Dependencies["upload"],
  input: Parameters<Dependencies["upload"]>[0],
  signal?: AbortSignal,
): Promise<void> {
  try {
    await upload(input);
  } catch (error) {
    if (!transientUploadError(error, signal)) throw error;
    await upload(input);
  }
}

export async function abortPackageUpload(
  session: PackageUploadSessionIdentity,
  dependencies: Readonly<{
    request<T>(path: string, init?: RequestInit): Promise<T>;
    idFactory?: () => string;
  }>,
): Promise<void> {
  await dependencies.request(`/owner/packages/${encodeURIComponent(session.packageId)}/abort`, {
    method: "POST",
    headers: {
      "idempotency-key": (dependencies.idFactory ?? (() => crypto.randomUUID()))(),
      "x-upload-id": session.uploadId,
    },
  });
}

export async function runPackageUploadFlow(
  file: File,
  password: string,
  dependencies: Dependencies,
): Promise<Readonly<{ id: string; status: string }>> {
  if (password.length === 0) throw new Error("请输入当前主密码");
  const idFactory = dependencies.idFactory ?? (() => crypto.randomUUID());
  const signalInit = dependencies.signal === undefined ? {} : { signal: dependencies.signal };
  const material = await dependencies.request<OwnerVaultMaterial>(
    "/owner/vault/material",
    signalInit,
  );
  const shareGenerationId = material.activeShareGenerationId;
  if (shareGenerationId === undefined || shareGenerationId.length === 0) {
    throw new Error("请先激活当前联系人分片代次");
  }
  if (!Number.isSafeInteger(material.nextPackageVersion) || material.nextPackageVersion < 1) {
    throw new Error("服务端返回的文件包版本无效");
  }
  const packageId = idFactory();
  const packageVersion = material.nextPackageVersion;
  const prepared = await dependencies.prepare({
    file,
    password,
    envelope: material.ownerVaultEnvelope,
    vaultId: material.vaultId,
    shareGenerationId,
    packageId,
    packageVersion,
  });

  const session = await dependencies.request<
    Readonly<{
      package: Readonly<{ id: string; versionNo: number; status: string }>;
      upload: Readonly<{ uploadId: string; url?: string }>;
    }>
  >("/owner/packages/uploads", {
    method: "POST",
    headers: { "idempotency-key": idFactory() },
    ...signalInit,
    body: json({
      packageId,
      packageVersion,
      vaultId: material.vaultId,
      shareGenerationId,
      cipherAlgorithm: "XCHACHA20_POLY1305_SECRETSTREAM_V1",
      streamHeader: prepared.streamHeader,
      encryptedSize: prepared.ciphertextSize,
      ciphertextSha256: prepared.ciphertextSha256,
      dekEnvelope: prepared.dekEnvelope,
      dekEnvelopeNonce: prepared.dekEnvelopeNonce,
      dekEnvelopeAlgorithm: prepared.dekEnvelopeAlgorithm,
      dekEnvelopeProtocolVersion: prepared.dekEnvelopeProtocolVersion,
      dekEnvelopeAadHash: prepared.dekEnvelopeAadHash,
      manifestCiphertext: prepared.manifestCiphertext,
      manifestNonce: prepared.manifestNonce,
      manifestAlgorithm: prepared.manifestAlgorithm,
      manifestAadHash: prepared.manifestAadHash,
      clientCryptoVersion: prepared.clientCryptoVersion,
    }),
  });
  if (session.package.id !== packageId || session.package.versionNo !== packageVersion) {
    throw new Error("服务端返回的文件包身份与浏览器加密上下文不一致");
  }
  if (session.upload.uploadId.length === 0) throw new Error("上传会话缺少一次性标识");
  dependencies.onSession?.({ packageId, uploadId: session.upload.uploadId });

  await uploadWithRetry(
    dependencies.upload,
    {
      path: `/owner/packages/${packageId}/content`,
      body: prepared.ciphertext,
      headers: {
        "content-type": "application/octet-stream",
        "x-upload-id": session.upload.uploadId,
        "idempotency-key": idFactory(),
      },
      ...signalInit,
    },
    dependencies.signal,
  );
  await dependencies.request(`/owner/packages/${packageId}/complete`, {
    method: "POST",
    headers: { "idempotency-key": idFactory() },
    ...signalInit,
    body: json({
      uploadId: session.upload.uploadId,
      ciphertextSize: prepared.ciphertextSize,
      ciphertextSha256: prepared.ciphertextSha256,
    }),
  });
  return dependencies.request(`/owner/packages/${packageId}/activate`, {
    method: "POST",
    headers: { "idempotency-key": idFactory() },
    ...signalInit,
    body: json({
      password,
      ...(material.activePackage?.id === undefined
        ? {}
        : { expectedCurrentPackageId: material.activePackage.id }),
      expectedShareGenerationId: shareGenerationId,
    }),
  });
}
