const MAX_RETRY_DELAY_MS = 86_400_000;

export function computeRetryDelayMs(attempt: number, random: () => number = Math.random): number {
  if (!Number.isSafeInteger(attempt) || attempt < 1) {
    throw new RangeError("Retry attempt must be a positive safe integer");
  }
  const base = Math.min(MAX_RETRY_DELAY_MS, 1_000 * 2 ** Math.min(attempt - 1, 17));
  const jitter = Math.min(1, Math.max(0, random()));
  return Math.min(MAX_RETRY_DELAY_MS, base + Math.floor(base * jitter));
}
