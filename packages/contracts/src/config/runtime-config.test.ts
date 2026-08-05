import { Buffer } from "node:buffer";
import { describe, expect, test } from "vitest";
import { parseRuntimeConfig } from "./runtime-config.js";

const strongSecret = Buffer.alloc(32, 7).toString("base64");

function validEnvironment(overrides: Record<string, string | undefined> = {}) {
  return {
    NODE_ENV: "development",
    PUBLIC_BASE_URL: "http://localhost",
    DATABASE_URL: "postgresql://dls_api:development@postgres:5432/dls",
    MAIL_TRANSPORT_URL: "smtp://mailpit:1025",
    MAIL_FROM: "Digital Legacy System <no-reply@dls.local>",
    SESSION_SECRET: strongSecret,
    TOKEN_PEPPER: strongSecret,
    ...overrides,
  };
}

describe("parseRuntimeConfig", () => {
  test("uses safe development and filesystem defaults", () => {
    const config = parseRuntimeConfig(validEnvironment());

    expect(config.nodeEnv).toBe("development");
    expect(config.storage).toEqual({
      driver: "filesystem",
      privateRoot: expect.stringMatching(/[\\/]var[\\/]lib[\\/]dls[\\/]objects[\\/]private$/),
      stagingRoot: expect.stringMatching(/[\\/]var[\\/]lib[\\/]dls[\\/]objects[\\/]staging$/),
      publicRoot: expect.stringMatching(/[\\/]var[\\/]lib[\\/]dls[\\/]objects[\\/]public$/),
    });
    expect(config.security.trustedProxyHops).toBe(1);
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.security)).toBe(true);
  });

  test("does not require S3 variables for filesystem storage", () => {
    expect(() =>
      parseRuntimeConfig(validEnvironment({ STORAGE_DRIVER: "filesystem", S3_REGION: undefined })),
    ).not.toThrow();
  });

  test.each(["PUBLIC_BASE_URL", "DATABASE_URL", "MAIL_TRANSPORT_URL"])(
    "rejects an invalid URL in %s",
    (variable) => {
      expect(() => parseRuntimeConfig(validEnvironment({ [variable]: "not a url" }))).toThrow(
        variable,
      );
    },
  );

  test.each(["SESSION_SECRET", "TOKEN_PEPPER"])(
    "rejects weak %s without echoing it",
    (variable) => {
      const weakValue = Buffer.from("too short").toString("base64");

      expect(() => parseRuntimeConfig(validEnvironment({ [variable]: weakValue }))).toThrow(
        variable,
      );
      expect(() => parseRuntimeConfig(validEnvironment({ [variable]: weakValue }))).not.toThrow(
        weakValue,
      );
    },
  );

  test("rejects debug mode in production", () => {
    expect(() =>
      parseRuntimeConfig(validEnvironment({ NODE_ENV: "production", DEBUG: "true" })),
    ).toThrow("DEBUG");
  });

  test("normalizes configured filesystem paths without creating them", () => {
    const config = parseRuntimeConfig(
      validEnvironment({
        STORAGE_PRIVATE_ROOT: "./runtime/private",
        STORAGE_STAGING_ROOT: "./runtime/staging",
        STORAGE_PUBLIC_ROOT: "./runtime/public",
      }),
    );

    expect(config.storage.driver).toBe("filesystem");
    if (config.storage.driver === "filesystem") {
      expect(config.storage.privateRoot).toMatch(/[\\/]runtime[\\/]private$/);
      expect(config.storage.stagingRoot).toMatch(/[\\/]runtime[\\/]staging$/);
      expect(config.storage.publicRoot).toMatch(/[\\/]runtime[\\/]public$/);
    }
  });

  test.each([
    "S3_REGION",
    "S3_PRIVATE_BUCKET",
    "S3_PUBLIC_BUCKET",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
  ])("requires %s when S3 storage is selected", (variable) => {
    const s3 = {
      STORAGE_DRIVER: "s3",
      S3_REGION: "us-east-1",
      S3_PRIVATE_BUCKET: "dls-private",
      S3_PUBLIC_BUCKET: "dls-public",
      S3_ACCESS_KEY_ID: "local-access-key",
      S3_SECRET_ACCESS_KEY: "local-secret-key",
      [variable]: undefined,
    };

    expect(() => parseRuntimeConfig(validEnvironment(s3))).toThrow(variable);
  });

  test("parses a complete S3 configuration", () => {
    const config = parseRuntimeConfig(
      validEnvironment({
        STORAGE_DRIVER: "s3",
        S3_ENDPOINT: "http://minio:9000",
        S3_REGION: "us-east-1",
        S3_PRIVATE_BUCKET: "dls-private",
        S3_PUBLIC_BUCKET: "dls-public",
        S3_ACCESS_KEY_ID: "local-access-key",
        S3_SECRET_ACCESS_KEY: "local-secret-key",
        S3_FORCE_PATH_STYLE: "true",
      }),
    );

    expect(config.storage).toMatchObject({
      driver: "s3",
      endpoint: new URL("http://minio:9000"),
      forcePathStyle: true,
    });
  });
});
