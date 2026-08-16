import { Buffer } from "node:buffer";
import { resolve } from "node:path";
import { type ZodType, z } from "zod";
import { type FieldKeyring, parseFieldKeyring } from "./field-keyring.js";

export type RuntimeConfig = Readonly<{
  nodeEnv: "development" | "test" | "production";
  publicBaseUrl: URL;
  databaseUrl: string;
  storage:
    | { driver: "filesystem"; privateRoot: string; stagingRoot: string; publicRoot: string }
    | {
        driver: "s3";
        endpoint?: URL;
        region: string;
        privateBucket: string;
        stagingBucket: string;
        publicBucket: string;
        accessKeyId: string;
        secretAccessKey: string;
        forcePathStyle: boolean;
      };
  mail: { transportUrl: string; from: string };
  security: {
    sessionSecret: Uint8Array;
    tokenPepper: Uint8Array;
    fieldKeyring: FieldKeyring;
    trustedProxyHops: number;
  };
}>;

const booleanString = z.enum(["true", "false"]).transform((value) => value === "true");
const DEFAULT_FIELD_KEYRING = JSON.stringify({
  version: 1,
  activeVersion: 1,
  lookupKey: Buffer.alloc(32, 0x31).toString("base64"),
  lookupKeys: { 1: Buffer.alloc(32, 0x31).toString("base64") },
  keys: { 1: Buffer.alloc(32, 0x32).toString("base64") },
});

const commonEnvironmentSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PUBLIC_BASE_URL: z.url().default("http://localhost"),
    DATABASE_URL: z.url(),
    MAIL_TRANSPORT_URL: z.url().default("smtp://mailpit:1025"),
    MAIL_FROM: z.string().trim().min(1).default("Digital Legacy System <no-reply@dls.local>"),
    SESSION_SECRET: z.string().min(1),
    TOKEN_PEPPER: z.string().min(1),
    TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).default(1),
    DEBUG: booleanString.default(false),
  })
  .passthrough()
  .superRefine((environment, context) => {
    if (environment.NODE_ENV === "production" && environment.DEBUG) {
      context.addIssue({
        code: "custom",
        path: ["DEBUG"],
        message: "must be false in production",
      });
    }
  });

const filesystemEnvironmentSchema = z
  .object({
    STORAGE_DRIVER: z.literal("filesystem").default("filesystem"),
    STORAGE_PRIVATE_ROOT: z.string().min(1).default("/var/lib/dls/objects/private"),
    STORAGE_STAGING_ROOT: z.string().min(1).default("/var/lib/dls/objects/staging"),
    STORAGE_PUBLIC_ROOT: z.string().min(1).default("/var/lib/dls/objects/public"),
  })
  .passthrough();

const s3EnvironmentSchema = z
  .object({
    STORAGE_DRIVER: z.literal("s3"),
    S3_ENDPOINT: z.url().optional(),
    S3_REGION: z.string().trim().min(1),
    S3_PRIVATE_BUCKET: z.string().trim().min(1),
    S3_STAGING_BUCKET: z.string().trim().min(1),
    S3_PUBLIC_BUCKET: z.string().trim().min(1),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(1),
    S3_FORCE_PATH_STYLE: booleanString.default(false),
  })
  .passthrough();

function parseWithVariableNames<T>(
  schema: ZodType<T>,
  environment: Record<string, string | undefined>,
): T {
  const result = schema.safeParse(environment);
  if (result.success) {
    return result.data;
  }

  const issues = result.error.issues.map((issue) => {
    const variable = issue.path[0]?.toString() ?? "environment";
    return `${variable}: ${issue.message}`;
  });
  throw new Error(`Invalid runtime configuration: ${issues.join("; ")}`);
}

function decodeSecret(variable: string, value: string): Uint8Array {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error(`Invalid runtime configuration: ${variable}: must be valid base64`);
  }

  const secret = Uint8Array.from(Buffer.from(value, "base64"));
  if (secret.byteLength < 32) {
    throw new Error(`Invalid runtime configuration: ${variable}: must decode to at least 32 bytes`);
  }

  return secret;
}

function freezeObject<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value);
}

export function parseRuntimeConfig(environment: Record<string, string | undefined>): RuntimeConfig {
  if (environment.NODE_ENV === "production" && environment.DLS_TEST_MODE === "true") {
    throw new Error("Invalid runtime configuration: DLS_TEST_MODE=true is forbidden in production");
  }
  if (environment.NODE_ENV === "production") {
    for (const variable of ["PUBLIC_BASE_URL", "MAIL_TRANSPORT_URL", "MAIL_FROM"]) {
      if (!environment[variable]?.trim()) {
        throw new Error(`Invalid runtime configuration: ${variable}: is required in production`);
      }
    }
  }
  const common = parseWithVariableNames(commonEnvironmentSchema, environment);
  if (common.NODE_ENV === "production" && !environment.FIELD_KEYRING?.trim()) {
    throw new Error("Invalid runtime configuration: FIELD_KEYRING: is required in production");
  }
  const storage =
    environment.STORAGE_DRIVER === "s3"
      ? (() => {
          const s3 = parseWithVariableNames(s3EnvironmentSchema, environment);
          return freezeObject({
            driver: "s3" as const,
            ...(s3.S3_ENDPOINT ? { endpoint: new URL(s3.S3_ENDPOINT) } : {}),
            region: s3.S3_REGION,
            privateBucket: s3.S3_PRIVATE_BUCKET,
            stagingBucket: s3.S3_STAGING_BUCKET,
            publicBucket: s3.S3_PUBLIC_BUCKET,
            accessKeyId: s3.S3_ACCESS_KEY_ID,
            secretAccessKey: s3.S3_SECRET_ACCESS_KEY,
            forcePathStyle: s3.S3_FORCE_PATH_STYLE,
          });
        })()
      : (() => {
          const filesystem = parseWithVariableNames(filesystemEnvironmentSchema, environment);
          return freezeObject({
            driver: "filesystem" as const,
            privateRoot: resolve(filesystem.STORAGE_PRIVATE_ROOT),
            stagingRoot: resolve(filesystem.STORAGE_STAGING_ROOT),
            publicRoot: resolve(filesystem.STORAGE_PUBLIC_ROOT),
          });
        })();

  const config: RuntimeConfig = {
    nodeEnv: common.NODE_ENV,
    publicBaseUrl: new URL(common.PUBLIC_BASE_URL),
    databaseUrl: common.DATABASE_URL,
    storage,
    mail: freezeObject({ transportUrl: common.MAIL_TRANSPORT_URL, from: common.MAIL_FROM }),
    security: freezeObject({
      sessionSecret: decodeSecret("SESSION_SECRET", common.SESSION_SECRET),
      tokenPepper: decodeSecret("TOKEN_PEPPER", common.TOKEN_PEPPER),
      fieldKeyring: parseFieldKeyring(environment.FIELD_KEYRING ?? DEFAULT_FIELD_KEYRING),
      trustedProxyHops: common.TRUSTED_PROXY_HOPS,
    }),
  };

  return freezeObject(config);
}
