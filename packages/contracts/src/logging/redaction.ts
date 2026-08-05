export const SENSITIVE_LOG_KEYS = Object.freeze([
  "password",
  "secret",
  "token",
  "cookie",
  "authorization",
  "key",
  "share",
  "ciphertext",
  "will",
]);

export function redactLogValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactLogValue);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      SENSITIVE_LOG_KEYS.some((sensitive) => key.toLowerCase().includes(sensitive))
        ? "[REDACTED]"
        : redactLogValue(entry),
    ]),
  );
}
