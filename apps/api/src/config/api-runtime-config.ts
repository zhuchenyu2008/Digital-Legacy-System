export type ApiRuntimeConfig = Readonly<{
  nodeEnv: "development" | "test" | "production";
  databaseUrl: string;
  publicBaseUrl: string;
  setupToken: string;
  sessionSecret: Uint8Array;
  tokenPepper: Uint8Array;
  contactPasswordPepper: Uint8Array;
  contactConsentVersion: string;
  contactConsentSha256: string;
  sessionPepper: Uint8Array;
  allowedOrigins: readonly string[];
  mailTransportUrl: string;
  mailFrom: string;
  smtpConfigured: boolean;
}>;

const DEFAULT_DATABASE_URL = "postgresql://postgres:test@127.0.0.1:55432/dls";
const DEFAULT_PUBLIC_BASE_URL = "http://localhost:3000";

function secret(value: string | undefined, fallback: string): Uint8Array {
  return Uint8Array.from(
    Buffer.from(value ?? Buffer.from(fallback, "utf8").toString("base64"), "base64"),
  );
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
      "SESSION_PEPPER",
      "TOKEN_PEPPER",
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
  const tokenPepper = secret(environment.TOKEN_PEPPER, "local-token-pepper-0123456789012345");
  const sessionPepper = secret(
    environment.SESSION_PEPPER,
    "local-development-session-pepper-0123456789012345",
  );
  const contactConsentVersion = environment.CONTACT_CONSENT_VERSION ?? "2026-08-01";
  const contactConsentSha256 = environment.CONTACT_CONSENT_SHA256 ?? "00".repeat(32);
  if (nodeEnv === "production") {
    for (const [variable, encoded, value] of [
      ["SESSION_SECRET", environment.SESSION_SECRET, sessionSecret],
      ["SESSION_PEPPER", environment.SESSION_PEPPER, sessionPepper],
      ["TOKEN_PEPPER", environment.TOKEN_PEPPER, tokenPepper],
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
    tokenPepper,
    contactPasswordPepper: secret(
      environment.CONTACT_PASSWORD_PEPPER ?? environment.TOKEN_PEPPER,
      "local-contact-password-pepper-0123456789012345",
    ),
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
  });
}
