import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, relative, resolve } from "node:path";
import ts from "typescript";

const root = resolve(import.meta.dirname, "../..");
const typeScriptCli = resolve(root, "node_modules/typescript/bin/tsc");
const visited = new Set();
const orderedProjects = [];

function referencedConfig(configPath, referencePath) {
  const target = resolve(dirname(configPath), referencePath);
  return extname(target) === ".json" ? target : join(target, "tsconfig.json");
}

function visit(configPath) {
  const absolute = resolve(configPath);
  if (visited.has(absolute)) return;
  visited.add(absolute);
  const loaded = ts.readConfigFile(absolute, ts.sys.readFile);
  if (loaded.error) {
    throw new Error(ts.formatDiagnostic(loaded.error, ts.createCompilerHost({})));
  }
  for (const reference of loaded.config.references ?? []) {
    visit(referencedConfig(absolute, reference.path));
  }
  orderedProjects.push(absolute);
}

const solution = resolve(root, "tsconfig.json");
visit(solution);
const projects = orderedProjects.filter((project) => project !== solution);
for (const [index, project] of projects.entries()) {
  const buildInfo = join(tmpdir(), `dls-readonly-typecheck-${process.pid}-${index}.tsbuildinfo`);
  try {
    const result = spawnSync(
      process.execPath,
      [
        typeScriptCli,
        "-p",
        relative(root, project),
        "--noEmit",
        "--tsBuildInfoFile",
        buildInfo,
      ],
      { cwd: root, env: process.env, stdio: "inherit" },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  } finally {
    rmSync(buildInfo, { force: true });
  }
}

process.stdout.write(`${JSON.stringify({ checkedProjects: projects.length })}\n`);
