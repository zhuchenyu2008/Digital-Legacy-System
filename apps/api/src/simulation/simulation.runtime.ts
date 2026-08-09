import {
  type AdvanceSimulationCommand,
  type AdvanceSimulationResult,
  advanceSimulation,
  type CreateSimulationCommand,
  createSimulation,
  resetSimulation,
  type SimulationAuditEvent,
  SimulationError,
  type SimulationScenario,
  type SimulationStore,
} from "@dls/application";
import { Pool, type PoolClient } from "pg";

export const SIMULATION_RUNTIME = Symbol("DLS_SIMULATION_RUNTIME");

export type SimulationRuntimeConfig =
  | Readonly<{ enabled: false }>
  | Readonly<{
      enabled: true;
      databaseUrl: string;
      storageRoot: string;
      allowedRecipients: readonly string[];
    }>;

function configured(value: string | undefined, name: string): string {
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${name} is required when simulation mode is enabled`);
  }
  return value.trim();
}

export function getSimulationRuntimeConfig(
  environment: Record<string, string | undefined> = process.env,
): SimulationRuntimeConfig {
  if (environment.DLS_SIMULATION_MODE !== "enabled") return Object.freeze({ enabled: false });
  if (environment.NODE_ENV !== "test") {
    throw new Error("simulation mode may only run in the test environment");
  }
  const formalDatabaseUrl = configured(environment.DATABASE_URL, "DATABASE_URL");
  const databaseUrl = configured(environment.SIMULATION_DATABASE_URL, "SIMULATION_DATABASE_URL");
  if (new URL(databaseUrl).href === new URL(formalDatabaseUrl).href) {
    throw new Error("simulation mode requires a separate database");
  }
  const mailTransport = new URL(configured(environment.MAIL_TRANSPORT_URL, "MAIL_TRANSPORT_URL"));
  if (
    mailTransport.protocol !== "smtp:" ||
    !["mailpit", "127.0.0.1", "localhost"].includes(mailTransport.hostname)
  ) {
    throw new Error("simulation mail transport must target Mailpit");
  }
  const storageRoot = configured(environment.SIMULATION_STORAGE_ROOT, "SIMULATION_STORAGE_ROOT");
  if (!/(?:^|[\\/])simulations(?:[\\/]|$)/iu.test(storageRoot)) {
    throw new Error("simulation storage root must be inside a simulations directory");
  }
  const allowedRecipients = Object.freeze(
    (environment.SIMULATION_MAIL_ALLOWLIST ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
  );
  if (allowedRecipients.length === 0) {
    throw new Error("simulation mail allowlist must not be empty");
  }
  return Object.freeze({ enabled: true, databaseUrl, storageRoot, allowedRecipients });
}

async function transaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function scenarioDocument(row: Record<string, unknown>): SimulationScenario {
  const document = row.document as SimulationScenario;
  return Object.freeze({
    ...document,
    currentAt: new Date(String(row.current_at)).toISOString(),
    state: String(row.state) as SimulationScenario["state"],
    revision: Number(row.revision),
  });
}

export class PostgresSimulationStore implements SimulationStore {
  public constructor(private readonly pool: Pool) {}

  public async create(scenario: SimulationScenario): Promise<void> {
    await transaction(this.pool, async (client) => {
      await client.query(
        `INSERT INTO simulation.scenarios
          (simulation_id, owner_id, namespace, revision, document, created_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::timestamptz)`,
        [
          scenario.id,
          scenario.ownerId,
          scenario.namespace,
          scenario.revision,
          JSON.stringify(scenario),
          scenario.createdAt,
        ],
      );
      await client.query(
        `INSERT INTO simulation.clock_state
          (simulation_id, owner_id, start_at, current_at, state, revision)
         VALUES ($1, $2, $3::timestamptz, $4::timestamptz, $5, $6)`,
        [
          scenario.id,
          scenario.ownerId,
          scenario.startAt,
          scenario.currentAt,
          scenario.state,
          scenario.revision,
        ],
      );
    });
  }

  public async get(simulationId: string): Promise<SimulationScenario | null> {
    const result = await this.pool.query(
      `SELECT scenarios.document, clock_state.current_at, clock_state.state,
              clock_state.revision
       FROM simulation.scenarios
       JOIN simulation.clock_state USING (simulation_id)
       WHERE simulation_id = $1`,
      [simulationId],
    );
    const row = result.rows[0];
    return row === undefined ? null : scenarioDocument(row);
  }

  public async save(scenario: SimulationScenario): Promise<void> {
    await transaction(this.pool, async (client) => {
      const locked = await client.query(
        `SELECT clock_state.current_at, clock_state.revision
         FROM simulation.clock_state WHERE simulation_id = $1 FOR UPDATE`,
        [scenario.id],
      );
      const row = locked.rows[0];
      if (row === undefined) {
        throw new SimulationError("SIMULATION_NOT_FOUND", "simulation is unavailable");
      }
      if (Number(row.revision) !== scenario.revision - 1) {
        throw new Error("simulation revision conflict");
      }
      if (Date.parse(scenario.currentAt) < Date.parse(String(row.current_at))) {
        throw new SimulationError(
          "SIMULATION_TIME_BACKWARD",
          "simulation clock cannot move backward",
        );
      }
      await client.query(
        `UPDATE simulation.scenarios
         SET document = $2::jsonb, revision = $3
         WHERE simulation_id = $1`,
        [scenario.id, JSON.stringify(scenario), scenario.revision],
      );
      await client.query(
        `UPDATE simulation.clock_state
         SET current_at = $2::timestamptz, state = $3, revision = $4
         WHERE simulation_id = $1`,
        [scenario.id, scenario.currentAt, scenario.state, scenario.revision],
      );
    });
  }

  public async remove(simulationId: string): Promise<void> {
    await this.pool.query("DELETE FROM simulation.scenarios WHERE simulation_id = $1", [
      simulationId,
    ]);
  }

  public async appendAudit(event: SimulationAuditEvent): Promise<void> {
    await this.pool.query(
      `INSERT INTO simulation.audit_events
        (event_id, simulation_id, owner_id, event_type, occurred_at, payload)
       VALUES ($1, $2, $3, $4, $5::timestamptz, $6::jsonb)`,
      [
        event.eventId,
        event.simulationId,
        event.ownerId,
        event.eventType,
        event.occurredAt,
        JSON.stringify(event.payload),
      ],
    );
  }

  public async readIdempotentResult<T>(
    simulationId: string,
    idempotencyKey: string,
  ): Promise<T | null> {
    const result = await this.pool.query(
      `SELECT result FROM simulation.idempotency_results
       WHERE simulation_id = $1 AND idempotency_key = $2`,
      [simulationId, idempotencyKey],
    );
    return (result.rows[0]?.result as T | undefined) ?? null;
  }

  public async writeIdempotentResult<T>(
    simulationId: string,
    idempotencyKey: string,
    result: T,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO simulation.idempotency_results
        (simulation_id, idempotency_key, result)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (simulation_id, idempotency_key) DO NOTHING`,
      [simulationId, idempotencyKey, JSON.stringify(result)],
    );
  }
}

export interface SimulationRuntime {
  create(command: CreateSimulationCommand): Promise<SimulationScenario>;
  get(simulationId: string, ownerId: string): Promise<SimulationScenario>;
  advance(command: AdvanceSimulationCommand): Promise<AdvanceSimulationResult>;
  reset(simulationId: string, ownerId: string): Promise<void>;
}

class DisabledSimulationRuntime implements SimulationRuntime {
  readonly #error = () =>
    Promise.reject(new SimulationError("SIMULATION_DISABLED", "simulation mode is disabled"));

  public create(): Promise<SimulationScenario> {
    return this.#error();
  }

  public get(): Promise<SimulationScenario> {
    return this.#error();
  }

  public advance(): Promise<AdvanceSimulationResult> {
    return this.#error();
  }

  public reset(): Promise<void> {
    return this.#error();
  }
}

class EnabledSimulationRuntime implements SimulationRuntime {
  readonly #store: PostgresSimulationStore;

  public constructor(
    pool: Pool,
    private readonly config: Extract<SimulationRuntimeConfig, { enabled: true }>,
  ) {
    this.#store = new PostgresSimulationStore(pool);
  }

  public create(command: CreateSimulationCommand): Promise<SimulationScenario> {
    return createSimulation(command, {
      store: this.#store,
      allowedRecipients: this.config.allowedRecipients,
      testMode: true,
    });
  }

  public async get(simulationId: string, ownerId: string): Promise<SimulationScenario> {
    const value = await this.#store.get(simulationId);
    if (value === null)
      throw new SimulationError("SIMULATION_NOT_FOUND", "simulation is unavailable");
    if (value.ownerId !== ownerId)
      throw new SimulationError("SIMULATION_FORBIDDEN", "simulation belongs to another owner");
    return value;
  }

  public advance(command: AdvanceSimulationCommand): Promise<AdvanceSimulationResult> {
    return advanceSimulation(command, { store: this.#store });
  }

  public reset(simulationId: string, ownerId: string): Promise<void> {
    return resetSimulation({ simulationId, ownerId }, { store: this.#store });
  }
}

export function createSimulationRuntime(): SimulationRuntime {
  const config = getSimulationRuntimeConfig();
  return config.enabled
    ? new EnabledSimulationRuntime(new Pool({ connectionString: config.databaseUrl }), config)
    : new DisabledSimulationRuntime();
}
