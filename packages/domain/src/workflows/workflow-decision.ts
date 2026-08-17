export const WORKFLOW_DECISION = {
  DEATH_LIKELY: "DEATH_LIKELY",
  ALIVE: "ALIVE",
  RECOVERY_APPROVE: "RECOVERY_APPROVE",
} as const;

export type WorkflowDecision = (typeof WORKFLOW_DECISION)[keyof typeof WORKFLOW_DECISION];

export const WORKFLOW_DECISIONS = Object.freeze(
  Object.values(WORKFLOW_DECISION),
) as readonly WorkflowDecision[];

const WORKFLOW_DECISION_SET = new Set<unknown>(WORKFLOW_DECISIONS);

export function isWorkflowDecision(value: unknown): value is WorkflowDecision {
  return WORKFLOW_DECISION_SET.has(value);
}
