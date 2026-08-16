import { spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

export type SecretScanOptions = Readonly<{
  source: string;
  approved: readonly string[];
}>;

const ASSIGNED_SECRET =
  /\b(?:password|passwd|token|secret|private[_-]?key|api[_-]?key)\b\s*[:=]\s*([^\s,;"']+)/giu;
const PEM_SECRET = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u;
const AWS_ACCESS_KEY = /\bAKIA[0-9A-Z]{16}\b/u;
const RUNTIME_EXPRESSION =
  /^(?:[A-Za-z_$][A-Za-z0-9_$]*)(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*(?:[()[\]?.:<]|$)/u;

function approved(value: string, options: SecretScanOptions): boolean {
  return options.approved.some((candidate) => candidate.length >= 8 && candidate === value);
}

function runtimeOrPlaceholder(value: string): boolean {
  return (
    RUNTIME_EXPRESSION.test(value) ||
    value === "[REDACTED]" ||
    value.startsWith("${") ||
    value.startsWith("(") ||
    value.startsWith("&") ||
    value.startsWith("{") ||
    value.startsWith("<") ||
    value.startsWith("`") ||
    value.startsWith("==")
  );
}

export function scanText(text: string, options: SecretScanOptions): void {
  if (PEM_SECRET.test(text) || AWS_ACCESS_KEY.test(text)) {
    throw new Error(`secret-shaped material detected in ${options.source}`);
  }
  for (const match of text.matchAll(ASSIGNED_SECRET)) {
    const value = match[1];
    if (value !== undefined && !runtimeOrPlaceholder(value) && !approved(value, options)) {
      throw new Error(`secret-shaped assignment detected in ${options.source}`);
    }
  }
}

export function redactSecrets(text: string, secrets: readonly string[]): string {
  return secrets
    .filter((secret) => secret.length >= 8)
    .reduce((output, secret) => output.replaceAll(secret, "[REDACTED]"), text);
}

async function gitFiles(root: string): Promise<string[]> {
  const output = await new Promise<Buffer>((resolveOutput, rejectOutput) => {
    const child = spawn(
      "git",
      [
        "-c",
        "core.quotepath=false",
        "ls-files",
        "-z",
        "--cached",
        "--others",
        "--exclude-standard",
      ],
      { cwd: root, stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
    );
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", rejectOutput);
    child.once("exit", (code) => {
      if (code === 0) resolveOutput(Buffer.concat(stdout));
      else
        rejectOutput(new Error(`git ls-files failed: ${Buffer.concat(stderr).toString("utf8")}`));
    });
  });
  return output
    .toString("utf8")
    .split("\0")
    .filter((file) => file.length > 0)
    .filter(scannableFile);
}

function scannableFile(file: string): boolean {
  return (
    !/(?:^|\/)(?:\.git|\.worktrees|\.docker-config|\.acceptance-artifacts|\.e2e-runtime|node_modules|dist|\.next|test-results|playwright-report|coverage|target)(?:\/|$)/u.test(
      file,
    ) &&
    !file.startsWith("ops/secrets/generated/") &&
    !/\.(?:png|jpe?g|gif|webp|ico|zip|wasm|bin|pdf)$/iu.test(file)
  );
}

async function filesystemFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = resolve(directory, entry.name);
      const file = relative(root, absolute).replaceAll("\\", "/");
      if (!scannableFile(file)) continue;
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) files.push(file);
    }
  }
  await walk(root);
  return files.sort();
}

async function repositoryFiles(root: string): Promise<string[]> {
  try {
    return await gitFiles(root);
  } catch {
    return filesystemFiles(root);
  }
}

async function main(): Promise<void> {
  const root = resolve(process.argv[2] ?? process.cwd());
  const files = process.argv.length > 3 ? process.argv.slice(3) : await repositoryFiles(root);
  if (files.length === 0)
    throw new Error("No repository files were discovered for secret scanning");
  const approvalDocument = JSON.parse(
    await readFile(resolve(root, "ops/security/approved-test-secrets.json"), "utf8"),
  ) as { version?: unknown; values?: unknown };
  if (
    approvalDocument.version !== 1 ||
    !Array.isArray(approvalDocument.values) ||
    !approvalDocument.values.every((value) => typeof value === "string")
  ) {
    throw new Error("approved test secret fixture document is invalid");
  }
  const approvedFixtures = approvalDocument.values as string[];
  for (const file of files) {
    const text = await readFile(resolve(root, file), "utf8");
    scanText(text, { source: file, approved: approvedFixtures });
  }
}

if (process.argv[1]?.endsWith("secret-scan.ts") === true) {
  await main();
}
