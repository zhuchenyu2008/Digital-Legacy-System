import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

const AAD = Buffer.from("dls-secrets-backup-v1", "utf8");

function argument(name, args) {
  const index = args.indexOf(name);
  if (index < 0 || args[index + 1] === undefined) throw new Error(`${name} is required`);
  return args[index + 1];
}

async function keyFromFile(path) {
  const encoded = await requireText(readFile(path), path);
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32 || key.toString("base64") !== encoded) {
    throw new Error("backup key must be canonical base64 for exactly 32 bytes");
  }
  return key;
}

function requireText(promise, path) {
  return promise.then((value) => value.toString("utf8").trim());
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

function assertOutputOutsideSource(source, output) {
  const relativePath = relative(resolve(source), resolve(output));
  if (relativePath === "" || (!relativePath.startsWith(`..${sep}`) && relativePath !== ".." && !isAbsolute(relativePath))) {
    throw new Error("backup output must be outside the source secret directory");
  }
}

async function backup(args) {
  const source = resolve(argument("--source", args));
  const output = resolve(argument("--output", args));
  const keyPath = resolve(argument("--key-file", args));
  assertOutputOutsideSource(source, output);
  const sourceStat = await lstat(source);
  if (!sourceStat.isDirectory()) throw new Error("secret backup source must be a directory");
  const key = await keyFromFile(keyPath);
  const files = await filesUnder(source);
  const payload = Buffer.from(JSON.stringify({
    version: 1,
    createdAt: new Date().toISOString(),
    files: files.map(({ path, bytes }) => ({ path, data: bytes.toString("base64") })),
  }), "utf8");
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
  const tag = cipher.getAuthTag();
  const envelope = Buffer.from(JSON.stringify({
    version: 1,
    algorithm: "AES-256-GCM",
    nonce: nonce.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  }), "utf8");
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, envelope, { flag: "wx", mode: 0o600 });
  const digest = createHash("sha256").update(envelope).digest("hex");
  await writeFile(`${output}.manifest.json`, `${JSON.stringify({
    version: 1,
    createdAt: new Date().toISOString(),
    fileCount: files.length,
    ciphertextSha256: digest,
    keyFingerprint: createHash("sha256").update(key).digest("hex"),
  }, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({ output, manifest: `${output}.manifest.json`, fileCount: files.length, ciphertextSha256: digest }));
}

async function restore(args) {
  const bundle = resolve(argument("--bundle", args));
  const target = resolve(argument("--target", args));
  const keyPath = resolve(argument("--key-file", args));
  const force = args.includes("--force");
  const key = await keyFromFile(keyPath);
  const envelope = JSON.parse(await readFile(bundle, "utf8"));
  if (envelope.version !== 1 || envelope.algorithm !== "AES-256-GCM") throw new Error("unsupported secret backup envelope");
  const targetStat = await lstat(target).catch(() => null);
  if (targetStat !== null && !targetStat.isDirectory()) throw new Error("secret restore target must be a directory");
  await mkdir(target, { recursive: true, mode: 0o700 });
  const existing = await readdir(target);
  if (existing.length > 0 && !force) throw new Error("secret restore target is non-empty; pass --force explicitly");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.nonce, "base64"));
  decipher.setAAD(AAD);
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const payload = JSON.parse(Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8"));
  if (payload.version !== 1 || !Array.isArray(payload.files)) throw new Error("secret backup payload is invalid");
  for (const file of payload.files) {
    if (typeof file.path !== "string" || file.path.length === 0 || file.path.startsWith("/") || file.path.split("/").includes("..")) {
      throw new Error("secret backup contains an unsafe path");
    }
    const destination = resolve(target, file.path);
    if (!destination.startsWith(`${target}${sep}`)) throw new Error("secret restore escaped target");
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    await writeFile(destination, Buffer.from(file.data, "base64"), { mode: 0o600 });
  }
  console.log(JSON.stringify({ target, fileCount: payload.files.length }));
}

const [command, ...args] = process.argv.slice(2);
try {
  if (command === "backup") await backup(args);
  else if (command === "restore") await restore(args);
  else throw new Error("usage: secrets-backup.mjs backup|restore --source/--bundle ... --key-file ...");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
