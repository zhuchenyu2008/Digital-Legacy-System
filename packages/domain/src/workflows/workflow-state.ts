import type { Instant } from "../shared/instant.js";
import { type AggregateVersion, incrementAggregateVersion } from "../shared/version.js";

export type TransitionResult<S, E> = Readonly<{
  state: Readonly<S>;
  events: readonly E[];
}>;

export class InvalidTransitionError extends Error {
  readonly code = "INVALID_TRANSITION";

  constructor(message: string) {
    super(message);
    this.name = "InvalidTransitionError";
  }
}

export class StaleAggregateVersionError extends Error {
  readonly code = "STALE_AGGREGATE_VERSION";

  constructor(expected: AggregateVersion, actual: AggregateVersion) {
    super(`Stale aggregate version: expected ${expected}, actual ${actual}`);
    this.name = "StaleAggregateVersionError";
  }
}

export type VersionedCommand = Readonly<{ expectedVersion: AggregateVersion }>;

export type WorkflowEvent = Readonly<{
  type: string;
  occurredAt: Instant;
  aggregateVersion?: AggregateVersion;
  payload?: Readonly<Record<string, string | number>>;
}>;

export function assertExpectedVersion(actual: AggregateVersion, expected: AggregateVersion): void {
  if (actual !== expected) {
    throw new StaleAggregateVersionError(expected, actual);
  }
}

export function nextVersion(version: AggregateVersion): AggregateVersion {
  return incrementAggregateVersion(version);
}

export function invalidTransition(scope: string, state: string, command: string): never {
  throw new InvalidTransitionError(`Invalid ${scope} transition: ${state} -> ${command}`);
}

export function immutableSnapshot<T extends object>(state: T): Readonly<T> {
  return Object.freeze(state);
}

export function immutableArray<T>(values: readonly T[]): readonly T[] {
  return Object.freeze([...values]);
}
