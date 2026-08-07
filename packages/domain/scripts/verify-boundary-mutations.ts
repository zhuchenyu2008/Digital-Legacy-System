import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

type Mutation = Readonly<{
  id: string;
  file: string;
  from: string;
  to: string;
}>;

const packageRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const repositoryRoot = path.resolve(packageRoot, "../..");
const vitestEntry = path.join(repositoryRoot, "node_modules", "vitest", "vitest.mjs");
const mutations: readonly Mutation[] = [
  {
    id: "exact-deadline-is-due",
    file: "src/shared/instant.ts",
    from: "Temporal.Instant.compare(now, deadline) >= 0",
    to: "Temporal.Instant.compare(now, deadline) > 0",
  },
  {
    id: "threshold-may-equal-active-contacts",
    file: "src/policies/threshold-policy.ts",
    from: "threshold > activeContacts",
    to: "threshold >= activeContacts",
  },
  {
    id: "death-approval-threshold-is-inclusive",
    file: "src/workflows/death-workflow.ts",
    from: "approvedContactIds.length >= state.requiredConfirmations",
    to: "approvedContactIds.length > state.requiredConfirmations",
  },
  {
    id: "recovery-approval-threshold-is-inclusive",
    file: "src/workflows/recovery-workflow.ts",
    from: "approvedContactIds.length >= state.requiredApprovals",
    to: "approvedContactIds.length > state.requiredApprovals",
  },
];

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
