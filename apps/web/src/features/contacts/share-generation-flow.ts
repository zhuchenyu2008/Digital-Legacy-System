type OwnerVaultMaterial = Readonly<{
  vaultId: string;
  activeShareGenerationId?: string;
  contactSetVersion: number;
  ownerVaultEnvelope: Readonly<Record<string, unknown>>;
}>;

type ShareGenerationDraft = Readonly<{
  generationId: string;
  deathThreshold: number;
  recoveryThreshold: number;
  contactsSnapshotSha256: string;
  contacts: readonly Readonly<{ contactId: string; publicKey: string }>[];
}>;

export type ShareGenerationActivation = Readonly<{
  generationId: string;
  status: "ACTIVE";
  systemState: "READY" | "ARMED";
}>;

type Dependencies = Readonly<{
  request<T>(path: string, init?: RequestInit): Promise<T>;
  buildUpload(input: Readonly<Record<string, unknown>>): Promise<Readonly<Record<string, unknown>>>;
  idFactory?: () => string;
}>;

export async function runShareGenerationFlow(
  password: string,
  dependencies: Dependencies,
): Promise<ShareGenerationActivation> {
  if (password.length === 0) throw new Error("请输入当前主密码");
  const idFactory = dependencies.idFactory ?? (() => crypto.randomUUID());
  const material = await dependencies.request<OwnerVaultMaterial>("/owner/vault/material");
  const currentGeneration =
    material.activeShareGenerationId === undefined
      ? {}
      : { expectedCurrentGenerationId: material.activeShareGenerationId };
  const draft = await dependencies.request<ShareGenerationDraft>("/owner/vault/share-generations", {
    method: "POST",
    headers: { "idempotency-key": idFactory() },
    body: JSON.stringify({
      vaultId: material.vaultId,
      contactSetVersion: material.contactSetVersion,
      ...currentGeneration,
    }),
  });
  const upload = await dependencies.buildUpload({
    password,
    envelope: material.ownerVaultEnvelope,
    vaultId: material.vaultId,
    generationId: draft.generationId,
    contactSetVersion: material.contactSetVersion,
    contactsSnapshotSha256: draft.contactsSnapshotSha256,
    deathThreshold: draft.deathThreshold,
    recoveryThreshold: draft.recoveryThreshold,
    contacts: draft.contacts,
  });
  await dependencies.request(`/owner/vault/share-generations/${draft.generationId}/upload`, {
    method: "POST",
    headers: { "idempotency-key": idFactory() },
    body: JSON.stringify(upload),
  });
  return dependencies.request<ShareGenerationActivation>(
    `/owner/vault/share-generations/${draft.generationId}/activate`,
    {
      method: "POST",
      headers: { "idempotency-key": idFactory() },
      body: JSON.stringify({
        contactSetVersion: material.contactSetVersion,
        ...currentGeneration,
      }),
    },
  );
}
