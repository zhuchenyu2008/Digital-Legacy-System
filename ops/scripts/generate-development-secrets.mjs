import { generateKeyPairSync, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const defaultDirectory = fileURLToPath(new URL("../secrets/generated/", import.meta.url));
const args = process.argv.slice(2);

function option(name) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

for (let index = 0; index < args.length; index += 1) {
  const argument = args[index];
  if (argument === "--rotate") continue;
  if (argument === "--directory") {
    index += 1;
    continue;
  }
  throw new Error(`unknown argument: ${argument}`);
}

const directory = resolve(option("--directory") ?? process.env.DLS_SECRETS_DIR ?? defaultDirectory);
const rotate = args.includes("--rotate");
if (directory === parse(directory).root) throw new Error("Secret directory must not be a filesystem root");
const configuredFileMode = process.env.DLS_SECRETS_FILE_MODE;
// Acceptance Compose runs non-root containers against file-backed secrets.
const fileMode =
  configuredFileMode === undefined ? 0o600 : configuredFileMode === "0444" ? 0o444 : undefined;
if (fileMode === undefined) {
  throw new Error("DLS_SECRETS_FILE_MODE must be 0444 when explicitly set");
}
const created = [];

mkdirSync(directory, { recursive: true, mode: 0o700 });
chmodSync(directory, 0o700);

function writeSecret(name, value) {
  const path = resolve(directory, name);
  if (existsSync(path) && !rotate) return;
  writeFileSync(path, value, {
    encoding: "utf8",
    flag: rotate ? "w" : "wx",
    mode: fileMode,
  });
  chmodSync(path, fileMode);
  created.push(name);
}

function rawX25519(jwk, member, label) {
  const encoded = jwk[member];
  if (typeof encoded !== "string") throw new Error(`Unable to export ${label}`);
  const raw = Buffer.from(encoded, "base64url");
  if (raw.length !== 32) throw new Error(`${label} must be 32 bytes`);
  return raw.toString("base64");
}

function writeKeyPair(purpose) {
  const publicName = `${purpose}-ingress-public-key`;
  const privateName = `${purpose}-ingress-private-key`;
  const hasPublic = existsSync(resolve(directory, publicName));
  const hasPrivate = existsSync(resolve(directory, privateName));
  if (hasPublic !== hasPrivate && !rotate) {
    throw new Error(
      `Refusing to create a mismatched ${purpose} ingress pair: keep or remove both key files together`,
    );
  }
  if (hasPublic && !rotate) return;

  const pair = generateKeyPairSync("x25519");
  writeSecret(publicName, rawX25519(pair.publicKey.export({ format: "jwk" }), "x", publicName));
  writeSecret(
    privateName,
    rawX25519(pair.privateKey.export({ format: "jwk" }), "d", privateName),
  );
}

for (const name of [
  "postgres-superuser-password",
  "api-db-password",
  "worker-db-password",
  "migrator-db-password",
  "backup-db-password",
  "health-db-password",
]) {
  writeSecret(name, randomBytes(32).toString("hex"));
}

for (const name of [
  "session-secret",
  "session-pepper",
  "setup-token",
  "token-pepper",
  "release-stage-kek",
  "recovery-stage-kek",
  "minio-secret-key",
]) {
  writeSecret(name, randomBytes(32).toString("base64"));
}

writeSecret("minio-access-key", randomBytes(16).toString("hex"));
writeKeyPair("release");
writeKeyPair("recovery");

if (created.length === 0) {
  process.stdout.write(`Development secrets already exist in ${directory}\n`);
} else {
  process.stdout.write(
    `${rotate ? "Rotated" : "Created"} ${created.length} secret files in ${directory}\n`,
  );
}
