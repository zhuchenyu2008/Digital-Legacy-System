import {
  parseSimulationInstant,
  type SimulationAuditEvent,
  SimulationError,
  type SimulationScenario,
  type SimulationStore,
} from "./simulation-clock.js";

export type CreateSimulationCommand = Readonly<{
  simulationId: string;
  ownerId: string;
  ownerEmail: string;
  contactEmails: readonly string[];
  startAt: string;
}>;

export type CreateSimulationDependencies = Readonly<{
  store: SimulationStore;
  allowedRecipients: readonly string[];
  testMode: boolean;
}>;

function matchesRecipient(value: string, rule: string): boolean {
  const normalizedValue = value.trim().toLowerCase();
  const normalizedRule = rule.trim().toLowerCase();
  if (normalizedRule.startsWith("*@")) {
    return normalizedValue.endsWith(normalizedRule.slice(1));
  }
  return normalizedValue === normalizedRule;
}

function validateRecipients(recipients: readonly string[], allowlist: readonly string[]): void {
  if (
    recipients.some((recipient) => !allowlist.some((rule) => matchesRecipient(recipient, rule)))
  ) {
    throw new SimulationError(
      "RECIPIENT_NOT_ALLOWED",
      "simulation recipient is outside the configured allowlist",
    );
  }
}

export async function createSimulation(
  command: CreateSimulationCommand,
  dependencies: CreateSimulationDependencies,
): Promise<SimulationScenario> {
  if (!dependencies.testMode) {
    throw new SimulationError("SIMULATION_DISABLED", "simulation mode is disabled");
  }
  const startAt = parseSimulationInstant(command.startAt);
  validateRecipients(
    [command.ownerEmail, ...command.contactEmails],
    dependencies.allowedRecipients,
  );
  const namespace = `simulation:${command.simulationId}`;
  const scenario: SimulationScenario = Object.freeze({
    id: command.simulationId,
    ownerId: command.ownerId,
    namespace,
    createdAt: startAt,
    startAt,
    currentAt: startAt,
    state: "READY",
    revision: 0,
    synthetic: Object.freeze({
      ownerEmail: command.ownerEmail,
      contactEmails: Object.freeze([...command.contactEmails]),
      packageObjectKey: `simulations/${command.simulationId}/private/test.zip`,
      publicObjectKey: `simulations/${command.simulationId}/public/legacy.zip`,
    }),
    pendingMail: Object.freeze([
      Object.freeze({
        recipient: command.ownerEmail,
        subject: "【测试】仿真场景已创建",
        template: "simulation-created",
      }),
    ]),
  });
  await dependencies.store.create(scenario);
  const audit: SimulationAuditEvent = Object.freeze({
    eventId: `${namespace}:created`,
    simulationId: scenario.id,
    ownerId: scenario.ownerId,
    eventType: "simulation.created",
    occurredAt: startAt,
    payload: Object.freeze({ namespace, contactCount: command.contactEmails.length }),
  });
  await dependencies.store.appendAudit(audit);
  return scenario;
}
