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
  const publicBaseUrl = environment.PUBLIC_BASE_URL ?? DEFAULT_PUBLIC_BASE_URL;
  const tokenPepper = secret(environment.TOKEN_PEPPER, "local-token-pepper-0123456789012345");
  return Object.freeze({
    nodeEnv:
      environment.NODE_ENV === "production"
        ? "production"
        : environment.NODE_ENV === "test"
          ? "test"
          : "development",
    databaseUrl: environment.DATABASE_URL ?? DEFAULT_DATABASE_URL,
    publicBaseUrl,
    setupToken: environment.SETUP_TOKEN ?? "local-setup-token",
    sessionSecret: secret(environment.SESSION_SECRET, "local-session-secret-0123456789012345"),
    tokenPepper,
    contactPasswordPepper: secret(
      environment.CONTACT_PASSWORD_PEPPER ?? environment.TOKEN_PEPPER,
      "local-contact-password-pepper-0123456789012345",
    ),
    contactConsentVersion: environment.CONTACT_CONSENT_VERSION ?? "2026-08-01",
    contactConsentSha256: environment.CONTACT_CONSENT_SHA256 ?? "00".repeat(32),
    sessionPepper: secret(
      environment.SESSION_PEPPER,
      "local-development-session-pepper-0123456789012345",
    ),
    allowedOrigins: Object.freeze([
      ...new Set([new URL(publicBaseUrl).origin, DEFAULT_PUBLIC_BASE_URL]),
    ]),
  });
}
