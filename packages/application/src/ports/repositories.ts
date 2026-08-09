export type RepositoryRow = Readonly<{
  version: number;
  [column: string]: unknown;
}>;

export type RepositoryInput = Readonly<Record<string, unknown>>;

import type { IdempotencyRepository } from "./idempotency.js";

export interface VersionedRepository {
  findById(id: unknown, options?: { forUpdate?: boolean }): Promise<RepositoryRow | null>;
  findOneBy?(
    field: string,
    value: unknown,
    options?: { forUpdate?: boolean },
  ): Promise<RepositoryRow | null>;
  findFirst?(options?: { forUpdate?: boolean }): Promise<RepositoryRow | null>;
  findMany?(
    field?: string,
    value?: unknown,
    options?: { forUpdate?: boolean },
  ): Promise<readonly RepositoryRow[]>;
  insert(input: RepositoryInput): Promise<RepositoryRow>;
  updateById?(id: unknown, patch: RepositoryInput): Promise<RepositoryRow>;
  updateVersioned(
    id: unknown,
    expectedVersion: number,
    patch: RepositoryInput,
  ): Promise<RepositoryRow>;
}

export type Repositories = Readonly<{
  ownerProfile: VersionedRepository;
  ownerCredentials: VersionedRepository;
  systemSettings: VersionedRepository;
  checkIns: VersionedRepository;
  checkinSchedules: VersionedRepository;
  contacts: VersionedRepository;
  contactInvitations?: VersionedRepository;
  contactConsents?: VersionedRepository;
  oneTimeTokens?: VersionedRepository;
  shareGenerations?: VersionedRepository;
  contactKeyShares?: VersionedRepository;
  vaults: VersionedRepository;
  workflows: VersionedRepository;
  workflowContacts?: VersionedRepository;
  workflowContactActions?: VersionedRepository;
  workflowKeyFragments?: VersionedRepository;
  releaseSecretSessions?: VersionedRepository;
  recoverySecretSessions?: VersionedRepository;
  passwordRewrapSessions?: VersionedRepository;
  emailVerificationCodes?: VersionedRepository;
  notifications?: VersionedRepository;
  authSessions?: VersionedRepository;
  packages: VersionedRepository;
  idempotency: IdempotencyRepository;
}>;
