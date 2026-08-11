export type SimulationMail = Readonly<{
  recipient: string;
  subject: string;
  template: string;
}>;

export type SimulationMilestone =
  | "CHECKIN_DUE"
  | "CONTACT_DECISION"
  | "RECOVERY_THRESHOLD"
  | "RELEASE_COUNTDOWN"
  | "SMTP_RETRY"
  | "PUBLICATION";

export type SimulationContactDecision = "ALIVE" | "DEATH_LIKELY";

export type SimulationWorkflowState =
  | "SCHEDULED"
  | "AWAITING_CONFIRMATIONS"
  | "RELEASE_PENDING"
  | "CANCELLED_ALIVE"
  | "CANCELLED_OWNER"
  | "PUBLISH_LOCKED"
  | "PUBLISHED";

export type SimulationWorkflow = Readonly<{
  id: string;
  state: SimulationWorkflowState;
  requiredCount: number;
  contactIds: readonly string[];
  contactDecisions: readonly Readonly<{
    contactId: string;
    decision: SimulationContactDecision;
    decidedAt: string;
  }>[];
  disclosureMailSent: boolean;
  startedAt?: string;
  releaseAt?: string;
  publishLockedAt?: string;
  rescheduledCheckinAt?: string;
  publication?: Readonly<{
    objectKey: string;
    publishedAt: string;
    willHtml: string;
    plaintextSha256: string;
  }>;
}>;

export type SimulationScenario = Readonly<{
  id: string;
  ownerId: string;
  namespace: string;
  createdAt: string;
  startAt: string;
  currentAt: string;
  state: "READY" | SimulationMilestone;
  revision: number;
  synthetic: Readonly<{
    ownerEmail: string;
    contactEmails: readonly string[];
    contactIds: readonly string[];
    packageObjectKey: string;
    publicObjectKey: string;
    workflow: SimulationWorkflow;
  }>;
  pendingMail: readonly SimulationMail[];
}>;

export type SimulationAuditEvent = Readonly<{
  eventId: string;
  simulationId: string;
  ownerId: string;
  eventType: "simulation.created" | "simulation.advanced" | "simulation.reset";
  occurredAt: string;
  payload: Readonly<Record<string, unknown>>;
}>;

export interface SimulationStore {
  create(scenario: SimulationScenario): Promise<void>;
  get(simulationId: string): Promise<SimulationScenario | null>;
  save(scenario: SimulationScenario): Promise<void>;
  remove(simulationId: string): Promise<void>;
  appendAudit(event: SimulationAuditEvent): Promise<void>;
  readIdempotentResult<T>(simulationId: string, idempotencyKey: string): Promise<T | null>;
  writeIdempotentResult<T>(simulationId: string, idempotencyKey: string, result: T): Promise<void>;
}

export type SimulationErrorCode =
  | "SIMULATION_DISABLED"
  | "SIMULATION_NOT_FOUND"
  | "SIMULATION_FORBIDDEN"
  | "SIMULATION_TIME_BACKWARD"
  | "RECIPIENT_NOT_ALLOWED"
  | "INVALID_SIMULATION_INPUT"
  | "SIMULATION_ACTION_UNAVAILABLE"
  | "SIMULATION_CONTACT_FORBIDDEN"
  | "SIMULATION_DECISION_REPLAYED"
  | "SIMULATION_OWNER_REAUTH_REQUIRED"
  | "SIMULATION_PUBLISH_LOCKED";

export class SimulationError extends Error {
  public constructor(
    public readonly code: SimulationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SimulationError";
  }
}

export function parseSimulationInstant(value: string): string {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) {
    throw new SimulationError("INVALID_SIMULATION_INPUT", "simulation time must be ISO-8601");
  }
  return new Date(milliseconds).toISOString();
}

export async function requireSimulation(
  store: SimulationStore,
  simulationId: string,
): Promise<SimulationScenario> {
  const scenario = await store.get(simulationId);
  if (scenario === null) {
    throw new SimulationError("SIMULATION_NOT_FOUND", "simulation is unavailable");
  }
  return scenario;
}

export function requireSimulationOwner(scenario: SimulationScenario, ownerId: string): void {
  if (scenario.ownerId !== ownerId) {
    throw new SimulationError("SIMULATION_FORBIDDEN", "simulation belongs to another owner");
  }
}

export class SimulationClock {
  public constructor(
    private readonly store: SimulationStore,
    private readonly simulationId: string,
  ) {}

  public async now(): Promise<string> {
    return (await requireSimulation(this.store, this.simulationId)).currentAt;
  }

  public async set(value: string): Promise<string> {
    const target = parseSimulationInstant(value);
    const scenario = await requireSimulation(this.store, this.simulationId);
    if (Date.parse(target) < Date.parse(scenario.currentAt)) {
      throw new SimulationError(
        "SIMULATION_TIME_BACKWARD",
        "simulation clock cannot move backward",
      );
    }
    await this.store.save({
      ...scenario,
      currentAt: target,
      revision: scenario.revision + 1,
    });
    return target;
  }
}
