import type {
  ActivatePackageInput,
  CompleteUploadInput,
  CreateUploadSessionInput,
  StreamUploadInput,
  UploadSession,
  VaultPackageRecord,
} from "@dls/application";
import { ServiceUnavailableException } from "@nestjs/common";

export const VAULT_RUNTIME = Symbol("VAULT_RUNTIME");

export type VaultRequestContext = Readonly<{
  ownerId: string;
  csrfToken: string;
  idempotencyKey: string;
  requestId?: string;
}>;

export interface VaultRuntime {
  createUploadSession(
    input: CreateUploadSessionInput,
    context: VaultRequestContext,
  ): Promise<UploadSession>;
  streamUpload(input: StreamUploadInput, context: VaultRequestContext): Promise<VaultPackageRecord>;
  completeUpload(
    input: CompleteUploadInput,
    context: VaultRequestContext,
  ): Promise<VaultPackageRecord>;
  activatePackage(
    input: ActivatePackageInput,
    context: VaultRequestContext,
  ): Promise<VaultPackageRecord>;
  listPackages(
    vaultId: string,
    context: VaultRequestContext,
  ): Promise<readonly VaultPackageRecord[]>;
  abortUpload(
    input: Readonly<{ packageId: string; uploadId: string }>,
    context: VaultRequestContext,
  ): Promise<VaultPackageRecord>;
}

export function createUnavailableVaultRuntime(): VaultRuntime {
  const unavailable = async (..._args: readonly unknown[]): Promise<never> => {
    throw new ServiceUnavailableException("vault runtime is not configured");
  };
  return {
    createUploadSession: unavailable,
    streamUpload: unavailable,
    completeUpload: unavailable,
    activatePackage: unavailable,
    listPackages: unavailable,
    abortUpload: unavailable,
  };
}
