import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

const AAD = Buffer.from("dls-secrets-backup-v1", "utf8");
const REQUIRED_PRODUCTION_FILES = Object.freeze([
  "alert-webhook-url",
  "api-db-password",
  "backup-db-password",
  "contact-password-pepper",
  "data-backup-key",
  "health-db-password",
  "migrator-db-password",
  "minio-access-key",
  "minio-secret-key",
  "postgres-superuser-password",
  "recovery-ingress-private-key",
  "recovery-ingress-public-key",
  "recovery-stage-kek",
  "release-ingress-private-key",
  "release-ingress-public-key",
  "release-stage-kek",
  "session-pepper",
  "session-secret",
  "setup-token",
  "token-pepper",
  "worker-db-password",
]);

function argument(name, args) {
  const index = args.indexOf(name);
  if (index < 0 || args[index + 1] === undefined) throw new Error(`${name} is required`);
  return args[index + 1];
}

function canonicalBase64(value, expectedLength, label) {
  if (typeof value !== "string") throw new Error(`${label} must be base64 text`);
  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== expectedLength || decoded.toString("base64") !== value) {
    decoded.fill(0);
    throw new Error(`${label} must be canonical base64 for exactly ${expectedLength} bytes`);
  }
  return decoded;
}

async function keyFromFile(path) {
  const encoded = (await readFile(path, "utf8")).trim();
  return canonicalBase64(encoded, 32, "backup key");
}

function isWithin(parent, candidate) {
  const value = relative(resolve(parent), resolve(candidate));
  return value === "" || (!value.startsWith(`..${sep}`) && value !== ".." && !isAbsolute(value));
}

async function filesUnder(root) {
  const result = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`secret backup refuses symlink: ${absolute}`);
      if (entry.isDirectory()) {
        await visit(absolute);
      } else if (entry.isFile()) {
        const path = relative(root, absolute).split(sep).join("/");
        if (path === "") throw new Error("secret backup encountered an invalid path");
        result.push({ path, bytes: await readFile(absolute) });
      } else {
        throw new Error(`secret backup refuses special file: ${absolute}`);
      }
    }
  }
  await visit(root);
  return result.sort((left, right) => left.path.localeCompare(right.path));
}

function assertSafeSeparation({ source, bundle, keyPath, mediaRoot, production }) {
  if (source && isWithin(source, bundle)) {
    throw new Error("backup output must be outside the source secret directory");
  }
  if (source && isWithin(source, keyPath)) {
    throw new Error("backup encryption key must be outside the source secret directory");
  }
  if (isWithin(dirname(bundle), keyPath)) {
    throw new Error("backup encryption key must not be stored beside the encrypted bundle");
  }
  if (production) {
    if (!mediaRoot) throw new Error("--media-root is required with --production");
    if (!isWithin(mediaRoot, bundle)) {
      throw new Error("production encrypted bundle must be inside --media-root");
    }
    if (isWithin(mediaRoot, keyPath)) {
      throw new Error("production backup key must use a separate failure domain from --media-root");
    }
  }
}

function assertRequiredFiles(files, production) {
  if (!production) return;
  const paths = new Set(files.map((file) => file.path));
  const missing = REQUIRED_PRODUCTION_FILES.filter((path) => !paths.has(path));
  if (missing.length > 0) throw new Error(`production secret set is incomplete: ${missing.join(", ")}`);
}

function parseEnvelope(text) {
  const envelope = JSON.parse(text);
  if (envelope.version !== 1 || envelope.algorithm !== "AES-256-GCM") {
    throw new Error("unsupported secret backup envelope");
  }
  const ciphertextLength = Buffer.from(envelope.ciphertext ?? "", "base64").length;
  if (ciphertextLength < 1) throw new Error("backup ciphertext is empty");
  return {
    nonce: canonicalBase64(envelope.nonce, 12, "backup nonce"),
    tag: canonicalBase64(envelope.tag, 16, "backup authentication tag"),
    ciphertext: canonicalBase64(envelope.ciphertext, ciphertextLength, "backup ciphertext"),
  };
}

function decryptPayload(envelopeText, key) {
  const envelope = parseEnvelope(envelopeText);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, envelope.nonce);
    decipher.setAAD(AAD);
    decipher.setAuthTag(envelope.tag);
    const plaintext = Buffer.concat([decipher.update(envelope.ciphertext), decipher.final()]);
    try {
      const payload = JSON.parse(plaintext.toString("utf8"));
      if (payload.version !== 1 || !Array.isArray(payload.files)) {
        throw new Error("secret backup payload is invalid");
      }
      for (const file of payload.files) {
        if (
          typeof file.path !== "string" ||
          file.path.length === 0 ||
          file.path.startsWith("/") ||
          file.path.split("/").includes("..") ||
          typeof file.data !== "string"
        ) {
          throw new Error("secret backup contains an unsafe file entry");
        }
      }
      return payload;
    } finally {
      plaintext.fill(0);
    }
  } finally {
    envelope.nonce.fill(0);
    envelope.tag.fill(0);
    envelope.ciphertext.fill(0);
  }
}

async function assertManifest(bundle, envelopeBytes, key) {
  const manifest = JSON.parse(await readFile(`${bundle}.manifest.json`, "utf8"));
  const digest = createHash("sha256").update(envelopeBytes).digest("hex");
  const fingerprint = createHash("sha256").update(key).digest("hex");
  if (
    manifest.version !== 1 ||
    manifest.ciphertextSha256 !== digest ||
    manifest.keyFingerprint !== fingerprint ||
    manifest.containsPlaintextSecrets !== false ||
    manifest.containsBackupKey !== false ||
    manifest.keyStorageRequirement !== "separate-offline-failure-domain"
  ) {
    throw new Error("secret backup manifest integrity or security boundary check failed");
  }
  return manifest;
}

async function backup(args) {
  const source = resolve(argument("--source", args));
  const output = resolve(argument("--output", args));
  const keyPath = resolve(argument("--key-file", args));
  const production = args.includes("--production");
  const mediaRoot = args.includes("--media-root") ? resolve(argument("--media-root", args)) : null;
  assertSafeSeparation({ source, bundle: output, keyPath, mediaRoot, production });
  const sourceStat = await lstat(source);
  if (!sourceStat.isDirectory()) throw new Error("secret backup source must be a directory");
  const key = await keyFromFile(keyPath);
  const files = await filesUnder(source);
  let payload;
  try {
    assertRequiredFiles(files, production);
    const encodedKey = key.toString("base64");
    if (
      files.some(
        (file) =>
          (file.bytes.length === key.length && file.bytes.equals(key)) ||
          file.bytes.toString("utf8").trim() === encodedKey,
      )
    ) {
      throw new Error("backup encryption key material must not be present in the source secrets");
    }
    payload = Buffer.from(
      JSON.stringify({
        version: 1,
        createdAt: new Date().toISOString(),
        files: files.map(({ path, bytes }) => ({ path, data: bytes.toString("base64") })),
      }),
      "utf8",
    );
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    cipher.setAAD(AAD);
    const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
    const tag = cipher.getAuthTag();
    const envelope = Buffer.from(
      JSON.stringify({
        version: 1,
        algorithm: "AES-256-GCM",
        nonce: nonce.toString("base64"),
        tag: tag.toString("base64"),
        ciphertext: ciphertext.toString("base64"),
      }),
      "utf8",
    );
    try {
      await mkdir(dirname(output), { recursive: true });
      await writeFile(output, envelope, { flag: "wx", mode: 0o600 });
      const digest = createHash("sha256").update(envelope).digest("hex");
      await writeFile(
        `${output}.manifest.json`,
        `${JSON.stringify(
          {
            version: 1,
            createdAt: new Date().toISOString(),
            fileCount: files.length,
            ciphertextSha256: digest,
            keyFingerprint: createHash("sha256").update(key).digest("hex"),
            containsPlaintextSecrets: false,
            containsBackupKey: false,
            keyStorageRequirement: "separate-offline-failure-domain",
          },
          null,
          2,
        )}\n`,
        { flag: "wx", mode: 0o600 },
      );
      console.log(
        JSON.stringify({
          output,
          manifest: `${output}.manifest.json`,
          fileCount: files.length,
          ciphertextSha256: digest,
        }),
      );
    } finally {
      nonce.fill(0);
      tag.fill(0);
      ciphertext.fill(0);
      envelope.fill(0);
    }
  } finally {
    key.fill(0);
    payload?.fill(0);
    for (const file of files) file.bytes.fill(0);
  }
}

async function verifyBundle(args) {
  const bundle = resolve(argument("--bundle", args));
  const keyPath = resolve(argument("--key-file", args));
  const production = args.includes("--production");
  const mediaRoot = args.includes("--media-root") ? resolve(argument("--media-root", args)) : null;
  assertSafeSeparation({ bundle, keyPath, mediaRoot, production });
  const key = await keyFromFile(keyPath);
  const envelopeBytes = await readFile(bundle);
  try {
    const manifest = await assertManifest(bundle, envelopeBytes, key);
    const payload = decryptPayload(envelopeBytes.toString("utf8"), key);
    assertRequiredFiles(payload.files, production);
    if (manifest.fileCount !== payload.files.length) throw new Error("secret backup file count mismatch");
    return { bundle, fileCount: payload.files.length, payload };
  } finally {
    envelopeBytes.fill(0);
    key.fill(0);
  }
}

async function restore(args) {
  const target = resolve(argument("--target", args));
  const force = args.includes("--force");
  const verified = await verifyBundle(args);
  const targetStat = await lstat(target).catch(() => null);
  if (targetStat !== null && !targetStat.isDirectory()) {
    throw new Error("secret restore target must be a directory");
  }
  await mkdir(target, { recursive: true, mode: 0o700 });
  const existing = await readdir(target);
  if (existing.length > 0 && !force) {
    throw new Error("secret restore target is non-empty; pass --force explicitly");
  }
  for (const file of verified.payload.files) {
    const destination = resolve(target, file.path);
    if (!destination.startsWith(`${target}${sep}`)) throw new Error("secret restore escaped target");
    const bytes = Buffer.from(file.data, "base64");
    try {
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
      await writeFile(destination, bytes, { mode: 0o600 });
    } finally {
      bytes.fill(0);
    }
  }
  console.log(JSON.stringify({ target, fileCount: verified.fileCount }));
}

const [command, ...args] = process.argv.slice(2);
try {
  if (command === "backup") await backup(args);
  else if (command === "verify") {
    const result = await verifyBundle(args);
    console.log(JSON.stringify({ bundle: result.bundle, fileCount: result.fileCount }));
  } else if (command === "restore") await restore(args);
  else {
    throw new Error(
      "usage: secrets-backup.mjs backup|verify|restore --source/--bundle ... --key-file ...",
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
