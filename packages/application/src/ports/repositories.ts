export type RepositoryRow = Readonly<{
  version: number;
  [column: string]: unknown;
}>;

export type RepositoryInput = Readonly<Record<string, unknown>>;

import type { IdempotencyRepository } from "./idempotency.js";

export interface VersionedRepository {
  findById(id: unknown, options?: { forUpdate?: boolean }): Promise<RepositoryRow | null>;
  insert(input: RepositoryInput): Promise<RepositoryRow>;
  updateVersioned(
    id: unknown,
    expectedVersion: number,
    patch: RepositoryInput,
  ): Promise<RepositoryRow>;
}

export type Repositories = Readonly<{
  ownerProfile: VersionedRepository;
  systemSettings: VersionedRepository;
  contacts: VersionedRepository;
  vaults: VersionedRepository;
  workflows: VersionedRepository;
  packages: VersionedRepository;
  idempotency: IdempotencyRepository;
}>;
