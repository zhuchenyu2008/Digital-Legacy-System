import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  boundaryMutations as mutations,
  boundarySourceFiles,
  findUncoveredBoundaryComparisons,
} from "./boundary-mutations.js";

const packageRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const repositoryRoot = path.resolve(packageRoot, "../..");
const vitestEntry = path.join(repositoryRoot, "node_modules", "vitest", "vitest.mjs");

const sources = Object.fromEntries(
  await Promise.all(
    boundarySourceFiles.map(async (file) => [file, await readFile(path.join(packageRoot, file), "utf8")]),
  ),
);
const uncoveredComparisons = findUncoveredBoundaryComparisons(sources, mutations);
if (uncoveredComparisons.length > 0) {
  throw new Error(`Missing boundary mutations:\n${uncoveredComparisons.join("\n")}`);
}

const mutationWorkspace = path.join(repositoryRoot, ".superpowers");
await mkdir(mutationWorkspace, { recursive: true });
const temporaryRoot = await mkdtemp(path.join(mutationWorkspace, "mutation-domain-"));

try {
  for (const mutation of mutations) {
    const caseRoot = path.join(temporaryRoot, mutation.id);
    await cp(path.join(packageRoot, "src"), path.join(caseRoot, "src"), { recursive: true });
    await cp(path.join(packageRoot, "package.json"), path.join(caseRoot, "package.json"));

    const target = path.join(caseRoot, mutation.file);
    const source = await readFile(target, "utf8");
    const occurrences = source.split(mutation.from).length - 1;
    if (occurrences !== 1) {
      throw new Error(
        `Mutation ${mutation.id} expected one exact match in ${mutation.file}, found ${occurrences}`,
      );
    }
    await writeFile(target, source.replace(mutation.from, mutation.to), "utf8");

    const result = spawnSync(
      process.execPath,
      [vitestEntry, "run", "--root", caseRoot, "--no-file-parallelism"],
      {
        cwd: caseRoot,
        encoding: "utf8",
      },
    );
    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;

    if (result.error !== undefined) {
      throw new Error(`Mutation ${mutation.id} could not start Vitest`, { cause: result.error });
    }
    if (result.status === 0) {
      throw new Error(`Mutation survived: ${mutation.id}`);
    }
    if (!/Failed Tests|Test Files\s+\d+ failed/u.test(output)) {
      throw new Error(`Mutation ${mutation.id} failed for an infrastructure reason:\n${output}`);
    }

    console.log(`Killed mutation: ${mutation.id}`);
  }

  console.log(`Killed all ${mutations.length} boundary mutations.`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
