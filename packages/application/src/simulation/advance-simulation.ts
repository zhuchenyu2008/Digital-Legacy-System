import {
  parseSimulationInstant,
  requireSimulation,
  requireSimulationOwner,
  type SimulationAuditEvent,
  SimulationError,
  type SimulationMilestone,
  type SimulationScenario,
  type SimulationStore,
} from "./simulation-clock.js";

const MILESTONES = Object.freeze([
  { type: "CHECKIN_DUE", hours: 72 },
  { type: "CONTACT_DECISION", hours: 96 },
  { type: "RECOVERY_THRESHOLD", hours: 120 },
  { type: "RELEASE_COUNTDOWN", hours: 144 },
  { type: "SMTP_RETRY", hours: 150 },
  { type: "PUBLICATION", hours: 168 },
] satisfies readonly Readonly<{ type: SimulationMilestone; hours: number }>[]);

export type AdvanceSimulationCommand = Readonly<{
  simulationId: string;
  ownerId: string;
  idempotencyKey: string;
  target: SimulationMilestone;
}>;

export type SimulationTransition = Readonly<{
  type: SimulationMilestone;
  occurredAt: string;
}>;

export type AdvanceSimulationResult = Readonly<{
  simulationId: string;
  currentAt: string;
  state: SimulationMilestone;
  events: readonly SimulationTransition[];
}>;

function milestone(type: SimulationMilestone) {
  const value = MILESTONES.find((entry) => entry.type === type);
  if (value === undefined) {
    throw new SimulationError("INVALID_SIMULATION_INPUT", "unknown simulation target");
  }
  return value;
}

function atOffset(startAt: string, hours: number): string {
  return new Date(Date.parse(startAt) + hours * 3_600_000).toISOString();
}

function transitions(scenario: SimulationScenario, target: SimulationMilestone) {
  const current = Date.parse(scenario.currentAt);
  const targetMilestone = milestone(target);
  const targetAt = parseSimulationInstant(atOffset(scenario.startAt, targetMilestone.hours));
  if (Date.parse(targetAt) < current) {
    throw new SimulationError(
      "SIMULATION_TIME_BACKWARD",
      "simulation target precedes the current clock",
    );
  }
  const events = MILESTONES.filter((entry) => entry.hours <= targetMilestone.hours)
    .map((entry) => ({ type: entry.type, occurredAt: atOffset(scenario.startAt, entry.hours) }))
    .filter((event) => Date.parse(event.occurredAt) > current);
  return { targetAt, events: Object.freeze(events) };
}

export async function advanceSimulation(
  command: AdvanceSimulationCommand,
  dependencies: Readonly<{ store: SimulationStore }>,
): Promise<AdvanceSimulationResult> {
  if (command.idempotencyKey.trim().length < 8) {
    throw new SimulationError(
      "INVALID_SIMULATION_INPUT",
      "simulation idempotency key must contain at least eight characters",
    );
  }
  const scenario = await requireSimulation(dependencies.store, command.simulationId);
  requireSimulationOwner(scenario, command.ownerId);
  const replay = await dependencies.store.readIdempotentResult<AdvanceSimulationResult>(
    command.simulationId,
    command.idempotencyKey,
  );
  if (replay !== null) return replay;

  const { targetAt, events } = transitions(scenario, command.target);
  const updated: SimulationScenario = Object.freeze({
    ...scenario,
    currentAt: targetAt,
    state: command.target,
    revision: scenario.revision + 1,
    pendingMail: Object.freeze([
      ...scenario.pendingMail,
      ...events
        .filter((event) => event.type === "SMTP_RETRY")
        .map(() =>
          Object.freeze({
            recipient: scenario.synthetic.ownerEmail,
            subject: "【测试】SMTP 失败重试",
            template: "simulation-smtp-retry",
          }),
        ),
    ]),
  });
  const result: AdvanceSimulationResult = Object.freeze({
    simulationId: scenario.id,
    currentAt: targetAt,
    state: command.target,
    events,
  });
  await dependencies.store.save(updated);
  const audit: SimulationAuditEvent = Object.freeze({
    eventId: `${scenario.namespace}:advance:${updated.revision}`,
    simulationId: scenario.id,
    ownerId: scenario.ownerId,
    eventType: "simulation.advanced",
    occurredAt: targetAt,
    payload: Object.freeze({
      target: command.target,
      eventTypes: Object.freeze(events.map((event) => event.type)),
    }),
  });
  await dependencies.store.appendAudit(audit);
  await dependencies.store.writeIdempotentResult(
    command.simulationId,
    command.idempotencyKey,
    result,
  );
  return result;
}
