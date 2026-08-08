export type BoundaryMutation = Readonly<{
  id: string;
  file: string;
  from: string;
  to: string;
}>;

export const boundarySourceFiles = [
  "src/shared/instant.ts",
  "src/policies/threshold-policy.ts",
  "src/workflows/death-workflow.ts",
  "src/workflows/recovery-workflow.ts",
] as const;

export const boundaryMutations: readonly BoundaryMutation[] = [
  {
    id: "exact-deadline-is-due",
    file: "src/shared/instant.ts",
    from: "Temporal.Instant.compare(now, deadline) >= 0",
    to: "Temporal.Instant.compare(now, deadline) > 0",
  },
  {
    id: "one-day-duration-is-valid",
    file: "src/shared/instant.ts",
    from: "value < 1",
    to: "value <= 1",
  },
  {
    id: "threshold-one-is-valid",
    file: "src/policies/threshold-policy.ts",
    from: "threshold < 1",
    to: "threshold <= 1",
  },
  {
    id: "one-active-contact-is-valid",
    file: "src/policies/threshold-policy.ts",
    from: "activeContacts < 1",
    to: "activeContacts <= 1",
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
    id: "death-snapshot-threshold-is-inclusive",
    file: "src/workflows/death-workflow.ts",
    from: "state.approvedCount >= state.requiredConfirmations",
    to: "state.approvedCount > state.requiredConfirmations",
  },
  {
    id: "death-one-contact-snapshot-is-valid",
    file: "src/workflows/death-workflow.ts",
    from: "state.contactIds.length < 1",
    to: "state.contactIds.length <= 1",
  },
  {
    id: "death-threshold-one-is-valid",
    file: "src/workflows/death-workflow.ts",
    from: "state.requiredConfirmations < 1",
    to: "state.requiredConfirmations <= 1",
  },
  {
    id: "death-threshold-may-equal-contact-count",
    file: "src/workflows/death-workflow.ts",
    from: "state.requiredConfirmations > state.contactIds.length",
    to: "state.requiredConfirmations >= state.contactIds.length",
  },
  {
    id: "death-one-day-release-delay-is-valid",
    file: "src/workflows/death-workflow.ts",
    from: "state.releaseDelayDays < 1",
    to: "state.releaseDelayDays <= 1",
  },
  {
    id: "recovery-approval-threshold-is-inclusive",
    file: "src/workflows/recovery-workflow.ts",
    from: "approvedContactIds.length >= state.requiredApprovals",
    to: "approvedContactIds.length > state.requiredApprovals",
  },
  {
    id: "recovery-snapshot-threshold-is-inclusive",
    file: "src/workflows/recovery-workflow.ts",
    from: "state.approvedCount >= state.requiredApprovals",
    to: "state.approvedCount > state.requiredApprovals",
  },
  {
    id: "recovery-one-contact-snapshot-is-valid",
    file: "src/workflows/recovery-workflow.ts",
    from: "state.contactIds.length < 1",
    to: "state.contactIds.length <= 1",
  },
  {
    id: "recovery-threshold-one-is-valid",
    file: "src/workflows/recovery-workflow.ts",
    from: "state.requiredApprovals < 1",
    to: "state.requiredApprovals <= 1",
  },
  {
    id: "recovery-threshold-may-equal-contact-count",
    file: "src/workflows/recovery-workflow.ts",
    from: "state.requiredApprovals > state.contactIds.length",
    to: "state.requiredApprovals >= state.contactIds.length",
  },
];

const numericComparisonPattern =
  /([A-Za-z_$][\w.$]*(?:\([^()]*\))?)\s*(>=|<=|>|<)\s*([A-Za-z_$][\w.$]*|\d+)/gu;

export function findUncoveredBoundaryComparisons(
  sources: Readonly<Record<string, string>>,
  mutations: readonly BoundaryMutation[],
): readonly string[] {
  const covered = new Set(mutations.map((mutation) => `${mutation.file}\0${mutation.from}`));
  const uncovered: string[] = [];

  for (const [file, source] of Object.entries(sources)) {
    for (const [index, line] of source.split(/\r?\n/u).entries()) {
      const codeOnly = line.replace(
        /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/gu,
        "",
      );
      if (/\b(?:type|interface)\b|Readonly<|Record<|TransitionResult</u.test(codeOnly)) {
        continue;
      }

      for (const match of codeOnly.matchAll(numericComparisonPattern)) {
        const expression = `${match[1]} ${match[2]} ${match[3]}`;
        if (!covered.has(`${file}\0${expression}`)) {
          uncovered.push(`${file}:${index + 1}: ${expression}`);
        }
      }
    }
  }

  return uncovered;
}
