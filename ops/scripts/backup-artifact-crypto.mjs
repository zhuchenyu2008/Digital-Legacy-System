import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { appendFile, lstat, readFile, rename, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { Writable } from "node:stream";

const MAGIC = Buffer.from("DLSBAK1\0", "ascii");
const AAD = Buffer.from("dls-ordinary-database-backup-v1", "utf8");
const HEADER_BYTES = MAGIC.length + 12;
const TAG_BYTES = 16;

function option(name) {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? undefined : process.argv[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`${name} is required`);
  return resolve(value);
}

async function readKey(path) {
  const encoded = (await readFile(path, "utf8")).trim();
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32 || key.toString("base64") !== encoded) {
    key.fill(0);
    throw new Error("data backup key must be canonical base64 for exactly 32 bytes");
  }
  return key;
}

async function encryptedParts(path) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.size <= HEADER_BYTES + TAG_BYTES) {
    throw new Error("encrypted database backup is truncated");
  }
  const header = Buffer.alloc(HEADER_BYTES);
  const handle = await import("node:fs/promises").then(({ open }) => open(path, "r"));
  try {
    await handle.read(header, 0, header.length, 0);
    if (!header.subarray(0, MAGIC.length).equals(MAGIC)) {
      throw new Error("database backup is not an encrypted DLS artifact");
    }
    const tag = Buffer.alloc(TAG_BYTES);
    await handle.read(tag, 0, tag.length, stat.size - TAG_BYTES);
    return {
      nonce: Buffer.from(header.subarray(MAGIC.length)),
      tag,
      ciphertextEnd: stat.size - TAG_BYTES - 1,
    };
  } finally {
    header.fill(0);
    await handle.close();
  }
}

async function encrypt(input, output, key) {
  if (input === output) throw new Error("plaintext input and encrypted output must be different files");
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(AAD);
  const temporary = `${output}.${process.pid}.partial`;
  try {
    const writer = createWriteStream(temporary, { flags: "wx", mode: 0o600 });
    writer.write(MAGIC);
    writer.write(nonce);
    await pipeline(createReadStream(input), cipher, writer);
    const tag = cipher.getAuthTag();
    try {
      await appendFile(temporary, tag);
      await rename(temporary, output);
    } finally {
      tag.fill(0);
    }
  } finally {
    nonce.fill(0);
    await rm(temporary, { force: true });
  }
}

async function decrypt(input, output, key) {
  const parts = await encryptedParts(input);
  const decipher = createDecipheriv("aes-256-gcm", key, parts.nonce);
  decipher.setAAD(AAD);
  decipher.setAuthTag(parts.tag);
  try {
    await pipeline(
      createReadStream(input, { start: HEADER_BYTES, end: parts.ciphertextEnd }),
      decipher,
      createWriteStream(output, { flags: "wx", mode: 0o600 }),
    );
  } catch (error) {
    await rm(output, { force: true });
    throw error;
  } finally {
    parts.nonce.fill(0);
    parts.tag.fill(0);
  }
}

async function verify(input, key) {
  const parts = await encryptedParts(input);
  const decipher = createDecipheriv("aes-256-gcm", key, parts.nonce);
  decipher.setAAD(AAD);
  decipher.setAuthTag(parts.tag);
  try {
    await pipeline(
      createReadStream(input, { start: HEADER_BYTES, end: parts.ciphertextEnd }),
      decipher,
      new Writable({ write(_chunk, _encoding, callback) { callback(); } }),
    );
  } finally {
    parts.nonce.fill(0);
    parts.tag.fill(0);
  }
}

const command = process.argv[2];
const input = option("--input");
const key = await readKey(option("--key-file"));
try {
  if (command === "encrypt") await encrypt(input, option("--output"), key);
  else if (command === "decrypt") await decrypt(input, option("--output"), key);
  else if (command === "verify") await verify(input, key);
  else throw new Error("usage: backup-artifact-crypto.mjs encrypt|decrypt|verify ...");
  console.log(JSON.stringify({ command, valid: true }));
} finally {
  key.fill(0);
}
