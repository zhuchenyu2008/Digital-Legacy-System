import { generateKeyPairSync, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const defaultDirectory = fileURLToPath(new URL("../secrets/generated/", import.meta.url));
const directory = resolve(process.env.DLS_SECRETS_DIR || defaultDirectory);
const created = [];

mkdirSync(directory, { recursive: true, mode: 0o700 });
chmodSync(directory, 0o700);

function writeMissing(name, value) {
  const path = resolve(directory, name);
  if (existsSync(path)) return;
  writeFileSync(path, value, { encoding: "utf8", flag: "wx", mode: 0o600 });
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
  if (hasPublic !== hasPrivate) {
    throw new Error(
      `Refusing to create a mismatched ${purpose} ingress pair: keep or remove both key files together`,
    );
  }
  if (hasPublic) return;

  const pair = generateKeyPairSync("x25519");
  writeMissing(publicName, rawX25519(pair.publicKey.export({ format: "jwk" }), "x", publicName));
  writeMissing(
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
  writeMissing(name, randomBytes(32).toString("hex"));
}

for (const name of [
  "session-secret",
  "token-pepper",
  "release-stage-kek",
  "recovery-stage-kek",
  "minio-secret-key",
]) {
  writeMissing(name, randomBytes(32).toString("base64"));
}

writeMissing("minio-access-key", randomBytes(16).toString("hex"));
writeKeyPair("release");
writeKeyPair("recovery");

if (created.length === 0) {
  process.stdout.write(`Development secrets already exist in ${directory}\n`);
} else {
  process.stdout.write(`Created ${created.length} development secret files in ${directory}\n`);
}
