import {
  type AdvanceSimulationCommand,
  type AdvanceSimulationResult,
  advanceSimulation,
  type CreateSimulationCommand,
  cancelSimulationOwner,
  createSimulation,
  finalizeSimulationPublication,
  lockSimulationPublication,
  recordSimulationContactDecision,
  resetSimulation,
  type SimulationAuditEvent,
  SimulationError,
  type SimulationScenario,
  type SimulationStore,
  type TransactionManager,
} from "@dls/application";
import { verifyServerPassword } from "@dls/crypto/node";
import { createPgPool, PgTransactionManager } from "@dls/persistence";
import { renderWill } from "@dls/storage";
import { Pool, type PoolClient } from "pg";
import { getApiRuntimeConfig } from "../config/api-runtime-config.js";
import {
  getSimulationRuntimeConfig,
  type SimulationRuntimeConfig,
} from "../config/simulation-runtime-config.js";
import { openSimulationArchive } from "./simulation-artifact.js";

export {
  getSimulationRuntimeConfig,
  type SimulationRuntimeConfig,
} from "../config/simulation-runtime-config.js";

export const SIMULATION_RUNTIME = Symbol("DLS_SIMULATION_RUNTIME");

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
  contactDecision(
    command: Parameters<typeof recordSimulationContactDecision>[0],
  ): Promise<SimulationScenario>;
  ownerCancel(command: Parameters<typeof cancelSimulationOwner>[0]): Promise<SimulationScenario>;
  lockPublication(
    command: Parameters<typeof lockSimulationPublication>[0],
  ): Promise<SimulationScenario>;
  finalizePublication(
    command: Parameters<typeof finalizeSimulationPublication>[0],
  ): Promise<SimulationScenario>;
  publication(
    simulationId: string,
    ownerId: string,
  ): Promise<NonNullable<SimulationScenario["synthetic"]["workflow"]["publication"]>>;
  download(
    simulationId: string,
    ownerId: string,
    range?: Readonly<{ start: number; endInclusive?: number }>,
  ): Promise<ReturnType<typeof openSimulationArchive>>;
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

  public contactDecision(): Promise<SimulationScenario> {
    return this.#error();
  }

  public ownerCancel(): Promise<SimulationScenario> {
    return this.#error();
  }

  public lockPublication(): Promise<SimulationScenario> {
    return this.#error();
  }

  public finalizePublication(): Promise<SimulationScenario> {
    return this.#error();
  }

  public publication(): Promise<never> {
    return this.#error();
  }

  public download(): Promise<never> {
    return this.#error();
  }
}

class EnabledSimulationRuntime implements SimulationRuntime {
  readonly #store: PostgresSimulationStore;

  public constructor(
    pool: Pool,
    private readonly config: Extract<SimulationRuntimeConfig, { enabled: true }>,
    private readonly ownerTransaction: TransactionManager,
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

  public contactDecision(command: Parameters<typeof recordSimulationContactDecision>[0]) {
    return recordSimulationContactDecision(command, { store: this.#store });
  }

  public ownerCancel(command: Parameters<typeof cancelSimulationOwner>[0]) {
    return cancelSimulationOwner(command, {
      store: this.#store,
      passwordVerifier: (password) => this.verifyOwnerPassword(password),
    });
  }

  public lockPublication(command: Parameters<typeof lockSimulationPublication>[0]) {
    return lockSimulationPublication(command, { store: this.#store });
  }

  public finalizePublication(command: Parameters<typeof finalizeSimulationPublication>[0]) {
    return finalizeSimulationPublication(command, {
      store: this.#store,
      renderWill: (source) => renderWill(source).html,
    });
  }

  public async publication(simulationId: string, ownerId: string) {
    const scenario = await this.get(simulationId, ownerId);
    const publication = scenario.synthetic.workflow.publication;
    if (scenario.synthetic.workflow.state !== "PUBLISHED" || publication === undefined) {
      throw new SimulationError("SIMULATION_NOT_FOUND", "simulation publication is unavailable");
    }
    return publication;
  }

  public async download(
    simulationId: string,
    ownerId: string,
    range?: Readonly<{ start: number; endInclusive?: number }>,
  ) {
    await this.publication(simulationId, ownerId);
    return openSimulationArchive(range);
  }

  private verifyOwnerPassword(password: string): Promise<boolean> {
    return this.ownerTransaction.run(async (tx) => {
      const credential = await tx.repositories.ownerCredentials.findById(true);
      return (
        typeof credential?.password_phc === "string" &&
        (await verifyServerPassword(
          password,
          getApiRuntimeConfig().tokenPepper,
          credential.password_phc,
        ))
      );
    });
  }
}

export function createSimulationRuntime(): SimulationRuntime {
  const config = getSimulationRuntimeConfig();
  if (!config.enabled) return new DisabledSimulationRuntime();
  return new EnabledSimulationRuntime(
    new Pool({ connectionString: config.databaseUrl }),
    config,
    new PgTransactionManager(createPgPool({ connectionString: getApiRuntimeConfig().databaseUrl })),
  );
}
