import { type FieldKeyring, parseFieldKeyring } from "@dls/contracts";

export type ApiRuntimeConfig = Readonly<{
  nodeEnv: "development" | "test" | "production";
  databaseUrl: string;
  publicBaseUrl: string;
  setupToken: string;
  sessionSecret: Uint8Array;
  fieldKeyring: FieldKeyring;
  tokenPepper: Uint8Array;
  contactPasswordPepper: Uint8Array;
  contactConsentVersion: string;
  contactConsentSha256: string;
  sessionPepper: Uint8Array;
  allowedOrigins: readonly string[];
  mailTransportUrl: string;
  mailFrom: string;
  smtpConfigured: boolean;
  trustedProxyCidrs: readonly string[];
  rateLimits: Readonly<{
    owner: Readonly<{ windowMs: number; maxAttempts: number }>;
    contact: Readonly<{ windowMs: number; maxAttempts: number }>;
    recovery: Readonly<{ windowMs: number; maxAttempts: number }>;
    token: Readonly<{ windowMs: number; maxAttempts: number }>;
  }>;
  workerHeartbeatStaleMs: number;
  databasePoolMax: number;
}>;

const DEFAULT_DATABASE_URL = "postgresql://postgres:test@127.0.0.1:55432/dls";
const DEFAULT_PUBLIC_BASE_URL = "http://localhost:3000";
const DEFAULT_FIELD_KEYRING = JSON.stringify({
  version: 1,
  activeVersion: 1,
  lookupKey: Buffer.alloc(32, 0x31).toString("base64"),
  lookupKeys: { 1: Buffer.alloc(32, 0x31).toString("base64") },
  keys: { 1: Buffer.alloc(32, 0x32).toString("base64") },
});

function secret(value: string | undefined, fallback: string): Uint8Array {
  return Uint8Array.from(
    Buffer.from(value ?? Buffer.from(fallback, "utf8").toString("base64"), "base64"),
  );
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function rateLimit(
  environment: Record<string, string | undefined>,
  prefix: string,
  defaults: Readonly<{ windowMs: number; maxAttempts: number }>,
) {
  return Object.freeze({
    windowMs: positiveInteger(environment[`RATE_LIMIT_${prefix}_WINDOW_MS`], defaults.windowMs),
    maxAttempts: positiveInteger(
      environment[`RATE_LIMIT_${prefix}_MAX_ATTEMPTS`],
      defaults.maxAttempts,
    ),
  });
}

export function getApiRuntimeConfig(
  environment: Record<string, string | undefined> = process.env,
): ApiRuntimeConfig {
  const nodeEnv =
    environment.NODE_ENV === "production"
      ? "production"
      : environment.NODE_ENV === "test"
        ? "test"
        : "development";
  if (nodeEnv === "production" && environment.DLS_TEST_MODE === "true") {
    throw new Error(
      "Invalid API runtime configuration: DLS_TEST_MODE=true is forbidden in production",
    );
  }
  if (nodeEnv === "production") {
    for (const variable of [
      "DATABASE_URL",
      "PUBLIC_BASE_URL",
      "SETUP_TOKEN",
      "SESSION_SECRET",
      "FIELD_KEYRING",
      "SESSION_PEPPER",
      "TOKEN_PEPPER",
      "CONTACT_PASSWORD_PEPPER",
      "MAIL_TRANSPORT_URL",
      "MAIL_FROM",
      "CONTACT_CONSENT_VERSION",
      "CONTACT_CONSENT_SHA256",
    ]) {
      if (!environment[variable]?.trim()) {
        throw new Error(`Invalid API runtime configuration: ${variable} is required`);
      }
    }
  }
  const publicBaseUrl = environment.PUBLIC_BASE_URL ?? DEFAULT_PUBLIC_BASE_URL;
  const setupToken = environment.SETUP_TOKEN ?? "local-setup-token";
  const sessionSecret = secret(environment.SESSION_SECRET, "local-session-secret-0123456789012345");
  const fieldKeyring = parseFieldKeyring(environment.FIELD_KEYRING ?? DEFAULT_FIELD_KEYRING);
  const tokenPepper = secret(environment.TOKEN_PEPPER, "local-token-pepper-0123456789012345");
  const sessionPepper = secret(
    environment.SESSION_PEPPER,
    "local-development-session-pepper-0123456789012345",
  );
  const contactPasswordPepper = secret(
    environment.CONTACT_PASSWORD_PEPPER,
    "local-contact-password-pepper-0123456789012345",
  );
  const contactConsentVersion = environment.CONTACT_CONSENT_VERSION ?? "2026-08-01";
  const contactConsentSha256 = environment.CONTACT_CONSENT_SHA256 ?? "00".repeat(32);
  const trustedProxyCidrs = Object.freeze(
    (environment.TRUSTED_PROXY_CIDRS ?? environment.DLS_TRUSTED_PROXY_CIDRS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
  );
  if (nodeEnv === "production") {
    for (const [variable, encoded, value] of [
      ["SESSION_SECRET", environment.SESSION_SECRET, sessionSecret],
      ["SESSION_PEPPER", environment.SESSION_PEPPER, sessionPepper],
      ["TOKEN_PEPPER", environment.TOKEN_PEPPER, tokenPepper],
      ["CONTACT_PASSWORD_PEPPER", environment.CONTACT_PASSWORD_PEPPER, contactPasswordPepper],
    ] as const) {
      if (
        value.byteLength < 32 ||
        encoded === undefined ||
        Buffer.from(value).toString("base64") !== encoded
      ) {
        throw new Error(
          `Invalid API runtime configuration: ${variable} must be canonical base64 for at least 32 bytes`,
        );
      }
    }
    const purposeSecrets = [
      ["SESSION_SECRET", sessionSecret],
      ["SESSION_PEPPER", sessionPepper],
      ["TOKEN_PEPPER", tokenPepper],
      ["CONTACT_PASSWORD_PEPPER", contactPasswordPepper],
    ] as const;
    for (let left = 0; left < purposeSecrets.length; left += 1) {
      for (let right = left + 1; right < purposeSecrets.length; right += 1) {
        const leftSecret = purposeSecrets[left];
        const rightSecret = purposeSecrets[right];
        if (
          leftSecret !== undefined &&
          rightSecret !== undefined &&
          Buffer.from(leftSecret[1]).equals(Buffer.from(rightSecret[1]))
        ) {
          throw new Error(
            `Invalid API runtime configuration: ${leftSecret[0]} and ${rightSecret[0]} must use distinct key material`,
          );
        }
      }
    }
    if (setupToken.length < 32) {
      throw new Error(
        "Invalid API runtime configuration: SETUP_TOKEN must be at least 32 characters",
      );
    }
    if (!/^[0-9a-f]{64}$/u.test(contactConsentSha256)) {
      throw new Error(
        "Invalid API runtime configuration: CONTACT_CONSENT_SHA256 must be a lowercase SHA-256 digest",
      );
    }
  }
  return Object.freeze({
    nodeEnv,
    databaseUrl: environment.DATABASE_URL ?? DEFAULT_DATABASE_URL,
    publicBaseUrl,
    setupToken,
    sessionSecret,
    fieldKeyring,
    tokenPepper,
    contactPasswordPepper,
    contactConsentVersion,
    contactConsentSha256,
    sessionPepper,
    allowedOrigins: Object.freeze([
      ...new Set([
        new URL(publicBaseUrl).origin,
        ...(nodeEnv === "production" ? [] : [DEFAULT_PUBLIC_BASE_URL]),
      ]),
    ]),
    mailTransportUrl: environment.MAIL_TRANSPORT_URL ?? "smtp://mailpit:1025",
    mailFrom: environment.MAIL_FROM ?? "Digital Legacy System <no-reply@dls.local>",
    smtpConfigured:
      typeof environment.MAIL_TRANSPORT_URL === "string" &&
      environment.MAIL_TRANSPORT_URL.trim().length > 0,
    trustedProxyCidrs,
    rateLimits: Object.freeze({
      owner: rateLimit(environment, "OWNER", { windowMs: 60_000, maxAttempts: 10 }),
      contact: rateLimit(environment, "CONTACT", { windowMs: 60_000, maxAttempts: 10 }),
      recovery: rateLimit(environment, "RECOVERY", { windowMs: 60_000, maxAttempts: 5 }),
      token: rateLimit(environment, "TOKEN", { windowMs: 60_000, maxAttempts: 20 }),
    }),
    workerHeartbeatStaleMs: positiveInteger(environment.WORKER_HEARTBEAT_STALE_MS, 90_000),
    databasePoolMax: Math.min(100, positiveInteger(environment.DATABASE_POOL_MAX, 8)),
  });
}
