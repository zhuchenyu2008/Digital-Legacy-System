import {
  requireSimulation,
  requireSimulationOwner,
  type SimulationContactDecision,
  SimulationError,
  type SimulationScenario,
  type SimulationStore,
} from "./simulation-clock.js";

type Dependencies = Readonly<{
  store: SimulationStore;
  renderWill?: (source: string) => string;
}>;

const SYNTHETIC_WILL_SOURCE = `# 测试遗嘱

<script>alert("simulation")</script>

[公开说明](https://example.test/legacy)`;
const SYNTHETIC_ARCHIVE_SHA256 = "d9b4652a34d5ef647e9ae5c0196faddd6117c91daf27ea1548bdd7dbcb6fbc4c";

function addHours(value: string, hours: number): string {
  return new Date(Date.parse(value) + hours * 3_600_000).toISOString();
}

async function save(
  scenario: SimulationScenario,
  workflow: SimulationScenario["synthetic"]["workflow"],
  store: SimulationStore,
): Promise<SimulationScenario> {
  const updated = Object.freeze({
    ...scenario,
    revision: scenario.revision + 1,
    synthetic: Object.freeze({ ...scenario.synthetic, workflow }),
  });
  await store.save(updated);
  return updated;
}

export async function recordSimulationContactDecision(
  command: Readonly<{
    simulationId: string;
    contactId: string;
    decision: SimulationContactDecision;
  }>,
  dependencies: Dependencies,
): Promise<SimulationScenario> {
  const scenario = await requireSimulation(dependencies.store, command.simulationId);
  const workflow = scenario.synthetic.workflow;
  if (!workflow.contactIds.includes(command.contactId)) {
    throw new SimulationError("SIMULATION_CONTACT_FORBIDDEN", "simulation contact is unavailable");
  }
  if (workflow.state !== "AWAITING_CONFIRMATIONS") {
    throw new SimulationError(
      "SIMULATION_ACTION_UNAVAILABLE",
      "simulation workflow is not awaiting contact decisions",
    );
  }
  if (workflow.contactDecisions.some((entry) => entry.contactId === command.contactId)) {
    throw new SimulationError(
      "SIMULATION_DECISION_REPLAYED",
      "simulation contact decision is final",
    );
  }
  const contactDecisions = Object.freeze([
    ...workflow.contactDecisions,
    Object.freeze({
      contactId: command.contactId,
      decision: command.decision,
      decidedAt: scenario.currentAt,
    }),
  ]);
  if (command.decision === "ALIVE") {
    return save(
      scenario,
      Object.freeze({
        ...workflow,
        state: "CANCELLED_ALIVE",
        contactDecisions,
        disclosureMailSent: true,
        rescheduledCheckinAt: addHours(scenario.currentAt, 72),
      }),
      dependencies.store,
    );
  }
  const approved = contactDecisions.filter((entry) => entry.decision === "DEATH_LIKELY").length;
  return save(
    scenario,
    Object.freeze({
      ...workflow,
      state: approved >= workflow.requiredCount ? "RELEASE_PENDING" : workflow.state,
      contactDecisions,
      ...(approved >= workflow.requiredCount ? { releaseAt: addHours(scenario.startAt, 144) } : {}),
    }),
    dependencies.store,
  );
}

export async function cancelSimulationOwner(
  command: Readonly<{ simulationId: string; ownerId: string; password: string }>,
  dependencies: Dependencies & Readonly<{ passwordVerifier(password: string): Promise<boolean> }>,
): Promise<SimulationScenario> {
  const scenario = await requireSimulation(dependencies.store, command.simulationId);
  requireSimulationOwner(scenario, command.ownerId);
  if (
    typeof command.password !== "string" ||
    command.password.length === 0 ||
    !(await dependencies.passwordVerifier(command.password))
  ) {
    throw new SimulationError(
      "SIMULATION_OWNER_REAUTH_REQUIRED",
      "current master password reauthentication is required",
    );
  }
  const workflow = scenario.synthetic.workflow;
  if (
    workflow.state === "PUBLISH_LOCKED" ||
    workflow.state === "PUBLISHED" ||
    (workflow.releaseAt !== undefined &&
      Date.parse(scenario.currentAt) >= Date.parse(workflow.releaseAt))
  ) {
    throw new SimulationError(
      "SIMULATION_PUBLISH_LOCKED",
      "simulation publication is irreversible",
    );
  }
  if (workflow.state !== "RELEASE_PENDING") {
    throw new SimulationError(
      "SIMULATION_ACTION_UNAVAILABLE",
      "simulation workflow cannot be cancelled by the owner",
    );
  }
  return save(
    scenario,
    Object.freeze({ ...workflow, state: "CANCELLED_OWNER", disclosureMailSent: true }),
    dependencies.store,
  );
}

export async function lockSimulationPublication(
  command: Readonly<{ simulationId: string; ownerId: string }>,
  dependencies: Dependencies,
): Promise<SimulationScenario> {
  const scenario = await requireSimulation(dependencies.store, command.simulationId);
  requireSimulationOwner(scenario, command.ownerId);
  const workflow = scenario.synthetic.workflow;
  if (workflow.state === "PUBLISH_LOCKED" || workflow.state === "PUBLISHED") return scenario;
  if (
    workflow.state !== "RELEASE_PENDING" ||
    workflow.releaseAt === undefined ||
    Date.parse(scenario.currentAt) < Date.parse(workflow.releaseAt)
  ) {
    throw new SimulationError(
      "SIMULATION_ACTION_UNAVAILABLE",
      "simulation release deadline has not been reached",
    );
  }
  return save(
    scenario,
    Object.freeze({ ...workflow, state: "PUBLISH_LOCKED", publishLockedAt: scenario.currentAt }),
    dependencies.store,
  );
}

export async function finalizeSimulationPublication(
  command: Readonly<{ simulationId: string; ownerId: string }>,
  dependencies: Dependencies,
): Promise<SimulationScenario> {
  const scenario = await requireSimulation(dependencies.store, command.simulationId);
  requireSimulationOwner(scenario, command.ownerId);
  const workflow = scenario.synthetic.workflow;
  if (workflow.state === "PUBLISHED") return scenario;
  if (workflow.state !== "PUBLISH_LOCKED") {
    throw new SimulationError(
      "SIMULATION_ACTION_UNAVAILABLE",
      "simulation publication is not locked",
    );
  }
  return save(
    scenario,
    Object.freeze({
      ...workflow,
      state: "PUBLISHED",
      publication: Object.freeze({
        objectKey: scenario.synthetic.publicObjectKey,
        publishedAt: scenario.currentAt,
        willHtml: dependencies.renderWill?.(SYNTHETIC_WILL_SOURCE) ?? "<h1>测试遗嘱</h1>",
        plaintextSha256: SYNTHETIC_ARCHIVE_SHA256,
      }),
    }),
    dependencies.store,
  );
}
