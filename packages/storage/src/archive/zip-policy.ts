import type { ArchivePolicy } from "@dls/application";

export const DEFAULT_ZIP_POLICY: ArchivePolicy = Object.freeze({
  maxArchiveBytes: 128 * 1024 * 1024,
  maxEntries: 10_000,
  maxUncompressedBytes: 256 * 1024 * 1024,
  maxCompressionRatio: 100,
  maxWillBytes: 2 * 1024 * 1024,
});

export class ZipPolicyError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ZipPolicyError";
    this.code = code;
  }
}

function assertLimit(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer`);
  }
}

export function resolveZipPolicy(overrides?: Partial<ArchivePolicy>): ArchivePolicy {
  const policy = { ...DEFAULT_ZIP_POLICY, ...overrides };
  assertLimit("maxArchiveBytes", policy.maxArchiveBytes);
  assertLimit("maxEntries", policy.maxEntries);
  assertLimit("maxUncompressedBytes", policy.maxUncompressedBytes);
  assertLimit("maxWillBytes", policy.maxWillBytes);
  if (!Number.isFinite(policy.maxCompressionRatio) || policy.maxCompressionRatio <= 0) {
    throw new TypeError("maxCompressionRatio must be greater than zero");
  }
  return Object.freeze(policy);
}
