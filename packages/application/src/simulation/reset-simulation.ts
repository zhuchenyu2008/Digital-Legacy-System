import {
  requireSimulation,
  requireSimulationOwner,
  type SimulationAuditEvent,
  type SimulationStore,
} from "./simulation-clock.js";

export async function resetSimulation(
  command: Readonly<{ simulationId: string; ownerId: string }>,
  dependencies: Readonly<{ store: SimulationStore }>,
): Promise<void> {
  const scenario = await requireSimulation(dependencies.store, command.simulationId);
  requireSimulationOwner(scenario, command.ownerId);
  await dependencies.store.remove(command.simulationId);
  const audit: SimulationAuditEvent = Object.freeze({
    eventId: `${scenario.namespace}:reset:${scenario.revision + 1}`,
    simulationId: scenario.id,
    ownerId: scenario.ownerId,
    eventType: "simulation.reset",
    occurredAt: scenario.currentAt,
    payload: Object.freeze({ previousState: scenario.state }),
  });
  await dependencies.store.appendAudit(audit);
}
