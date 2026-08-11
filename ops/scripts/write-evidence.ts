import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

export type GateEvidence = Readonly<{
  name: string;
  command: string;
  status: "passed" | "failed" | "skipped";
  exitCode: number | null;
  durationMs: number;
  startedAt: string;
  endedAt: string;
  outputFile?: string;
}>;

export type EvidenceInput = Readonly<{
  startedAt: string;
  endedAt: string;
  timezone: "Asia/Shanghai";
  gates: readonly GateEvidence[];
  artifacts?: readonly string[];
  blockers?: readonly string[];
  toolVersions?: Readonly<Record<string, string>>;
  system?: Readonly<{ os: string; architecture: string }>;
  releaseVersions?: Readonly<{
    migration: string;
    protocol: string;
    images: readonly string[];
    hashes?: Readonly<{
      protocolSha256: string;
      vectorsSha256: string;
      applicationSha256: string;
    }>;
  }>;
}>;

/**
 * Required acceptance gates are fail-closed: a skipped gate is not evidence
 * of completion, even when the rest of the evidence document can be written.
 */
export function assertRequiredGateResults(gates: readonly GateEvidence[]): void {
  const incomplete = gates.filter((gate) => gate.status !== "passed" || gate.exitCode !== 0);
  if (incomplete.length === 0) return;
  const names = incomplete.map((gate) => gate.name).join(", ");
  throw new Error(`required acceptance gates incomplete: ${names}`);
}

/**
 * Required suites may not silently turn an environment-dependent contract into
 * a green gate. Match only standardized runner summaries so prose mentioning a
 * skipped operation does not create a false positive.
 */
export function assertNoRequiredTestSkips(output: string): void {
  const normalized = output.replaceAll(String.fromCharCode(27), "").replace(/\[[0-9;]*m/gu, "");
  const patterns = [
    /\b(?:Tests?|Test Files)\s+[^\r\n]*\b([1-9]\d*)\s+skipped\b/giu,
    /(?:^|\n)\s*([1-9]\d*)\s+skipped(?:\s+\([^\r\n]+\))?\s*$/giu,
    /test result:\s+ok\.[^\r\n]*\b([1-9]\d*)\s+ignored\b/giu,
  ];
  if (patterns.some((pattern) => pattern.test(normalized))) {
    throw new Error("required tests skipped");
  }
}

function beijing(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    dateStyle: "medium",
    timeStyle: "medium",
    hour12: false,
  }).format(new Date(value));
}

function redact(value: string): string {
  return value
    .replace(
      /(password|secret|token|private[_-]?key|access[_-]?key)\s*[:=]\s*[^\s,;]+/giu,
      "$1=[REDACTED]",
    )
    .replace(/Bearer\s+[A-Za-z0-9._-]{16,}/gu, "Bearer [REDACTED]");
}

async function gitValue(args: readonly string[]): Promise<string> {
  try {
    return (await exec("git", [...args])).stdout.trim();
  } catch {
    return "unavailable";
  }
}

async function artifactLines(root: string, artifacts: readonly string[]): Promise<string[]> {
  const lines: string[] = [];
  for (const artifact of artifacts) {
    const path = resolve(root, artifact);
    try {
      const bytes = await readFile(path);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      lines.push(`- \`${artifact}\` — ${bytes.byteLength} bytes — SHA-256 \`${sha256}\``);
    } catch (error) {
      throw new Error(`declared artifact is missing or unreadable: ${artifact}`, { cause: error });
    }
  }
  return lines;
}

async function testSummary(root: string, gate: GateEvidence): Promise<string> {
  if (gate.outputFile === undefined) return "—";
  try {
    const output = await readFile(resolve(root, gate.outputFile), "utf8");
    const summaries: string[] = [];
    const vitest = output.match(/\bTests\s+(\d+\s+passed(?:\s+\|\s+\d+\s+failed)?)/iu)?.[1];
    const playwright = output.match(/(?:^|\n)\s*(\d+\s+passed)(?:\s+\([^\r\n]+\))?/iu)?.[1];
    const cargo = output.match(/test result:\s+ok\.\s+(\d+\s+passed;\s+\d+\s+failed)/iu)?.[1];
    for (const summary of [vitest, playwright, cargo]) {
      if (summary !== undefined && !summaries.includes(summary)) summaries.push(summary);
    }
    return summaries.length === 0 ? "—" : summaries.join("；");
  } catch {
    return "unavailable";
  }
}

export async function renderEvidence(input: EvidenceInput, root = process.cwd()): Promise<string> {
  const commit = await gitValue(["rev-parse", "HEAD"]);
  const dirty = await gitValue(["status", "--short"]);
  const passed = input.gates.filter((gate) => gate.status === "passed").length;
  const failed = input.gates.filter((gate) => gate.status === "failed").length;
  const skipped = input.gates.filter((gate) => gate.status === "skipped").length;
  const artifacts = await artifactLines(root, input.artifacts ?? []);
  const blockers = input.blockers ?? [
    "独立密码学评审、法律/遗嘱审查、人工渗透测试和人工恢复批准不由本地自动化 gate 代替。",
  ];
  const toolVersions = Object.entries(input.toolVersions ?? {}).map(
    ([name, version]) => `- ${name}: ${redact(version)}`,
  );
  const releaseVersions = input.releaseVersions;
  const system = input.system;
  const gateLines = await Promise.all(
    input.gates.map(async (gate) => {
      const summary = await testSummary(root, gate);
      return `| ${gate.name} | ${gate.status} | ${gate.exitCode ?? "-"} | ${gate.durationMs} | ${summary} | ${redact(gate.command)} |`;
    }),
  );
  return [
    "# Local V1 Acceptance Evidence",
    "",
    `- 开始（北京时间）：${beijing(input.startedAt)}`,
    `- 结束（北京时间）：${beijing(input.endedAt)}`,
    `- Git commit：\`${commit}\``,
    `- 工作树：${dirty.length === 0 ? "clean" : "dirty（证据生成期间允许 evidence 文件变化）"}`,
    `- Gate 汇总：${passed} passed / ${failed} failed / ${skipped} skipped`,
    `- 时区：\`${input.timezone}\``,
    `- 系统: ${system ? `${redact(system.os)} / ${redact(system.architecture)}` : "未记录"}`,
    `- 迁移版本: \`${releaseVersions?.migration ?? "未记录"}\``,
    `- 协议版本: \`${releaseVersions?.protocol ?? "未记录"}\``,
    `- Protocol SHA-256: \`${releaseVersions?.hashes?.protocolSha256 ?? "未记录"}\``,
    `- Vectors SHA-256: \`${releaseVersions?.hashes?.vectorsSha256 ?? "未记录"}\``,
    `- Application SHA-256: \`${releaseVersions?.hashes?.applicationSha256 ?? "未记录"}\``,
    "",
    "## 工具与版本",
    "",
    ...(toolVersions.length === 0
      ? ["- 由 acceptance 脚本记录；缺失版本视为 gate 失败。"]
      : toolVersions),
    "",
    "## 发行镜像",
    "",
    ...(releaseVersions?.images.map((value) => `- ${redact(value)}`) ?? ["- 未记录。"]),
    "",
    "## Gate 结果",
    "",
    "| Gate | 状态 | Exit | 耗时 ms | 测试统计 | 命令 |",
    "|---|---|---:|---:|---|---|",
    ...gateLines,
    "",
    "## Artifact SHA-256",
    "",
    ...(artifacts.length === 0 ? ["- 未提供 artifact。"] : artifacts),
    "",
    "## 外部/人工 blocker",
    "",
    ...blockers.map((blocker) => `- ${redact(blocker)}`),
    "",
    "本文件由 `ops/scripts/write-evidence.ts` 生成；环境变量、凭据、token 和密钥形状值会被脱敏。",
    "",
  ].join("\n");
}

function argument(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : (process.argv[index + 1] ?? fallback);
}

const inputPath = argument("--input");
const outputPath = argument("--output", "docs/acceptance/local-v1-evidence.md");
const skipLogPath = argument("--assert-no-skips");
if (skipLogPath !== undefined) {
  try {
    assertNoRequiredTestSkips(await readFile(resolve(skipLogPath), "utf8"));
  } catch (error) {
    process.stderr.write(`${String(error)}\n`);
    process.exitCode = 1;
  }
} else if (inputPath !== undefined && outputPath !== undefined) {
  const input = JSON.parse(await readFile(resolve(inputPath), "utf8")) as EvidenceInput;
  await writeFile(resolve(outputPath), await renderEvidence(input), "utf8");
  try {
    assertRequiredGateResults(input.gates);
  } catch (error) {
    process.stderr.write(`${String(error)}\n`);
    process.exitCode = 1;
  }
}
