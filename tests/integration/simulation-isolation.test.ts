import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { advanceSimulation, createSimulation, type SimulationScenario } from "@dls/application";
import { PgDatabaseClock } from "@dls/persistence";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  getSimulationRuntimeConfig,
  PostgresSimulationStore,
} from "../../apps/api/src/simulation/simulation.runtime.js";

const adminUrl = "postgresql://postgres:test@127.0.0.1:55432/postgres";
const formalUrl = "postgresql://postgres:test@127.0.0.1:55432/dls";
const simulationUrl = "postgresql://postgres:test@127.0.0.1:55432/dls_simulation";
const databaseName = "dls_simulation";
const ownerId = "00000000-0000-4000-8000-000000000201";
const simulationId = "00000000-0000-4000-8000-000000000202";
const startAt = "2026-08-10T00:00:00.000Z";

const admin = new Pool({ connectionString: adminUrl });
const formal = new Pool({ connectionString: formalUrl });
let simulation: Pool;

async function recreateSimulationDatabase(): Promise<void> {
  await admin.query(
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
    [databaseName],
  );
  await admin.query(`DROP DATABASE IF EXISTS ${databaseName}`);
  await admin.query(`CREATE DATABASE ${databaseName}`);
  simulation = new Pool({ connectionString: simulationUrl });
  const migration = await readFile(
    resolve("packages/persistence/migrations-test/001_simulation_schema.up.sql"),
    "utf8",
  );
  await simulation.query(migration);
}

async function createScenario(store: PostgresSimulationStore): Promise<SimulationScenario> {
  return createSimulation(
    {
      simulationId,
      ownerId,
      ownerEmail: "owner+simulation@example.test",
      contactEmails: ["contact-1@example.test", "contact-2@example.test", "contact-3@example.test"],
      startAt,
    },
    { store, allowedRecipients: ["*@example.test"], testMode: true },
  );
}

beforeAll(async () => {
  await recreateSimulationDatabase();
});

beforeEach(async () => {
  await simulation.query("TRUNCATE simulation.scenarios CASCADE");
  await simulation.query("TRUNCATE simulation.audit_events");
  await createScenario(new PostgresSimulationStore(simulation));
});

afterAll(async () => {
  await simulation.end();
  await formal.end();
  await admin.query(
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
    [databaseName],
  );
  await admin.query(`DROP DATABASE IF EXISTS ${databaseName}`);
  await admin.end();
});

describe("simulation database isolation", () => {
  it("keeps simulation tables and identifiers out of the formal database", async () => {
    const formalSchemas = await formal.query(
      "SELECT to_regclass('simulation.scenarios') AS simulation_table",
    );
    const simulationSchemas = await simulation.query("SELECT to_regnamespace('app') AS app_schema");
    const formalIdentifiers = await formal.query(
      "SELECT count(*)::int AS count FROM app.workflows WHERE id = $1",
      [simulationId],
    );
    const clock = await simulation.query(
      "SELECT current_at, owner_id FROM simulation.clock_state WHERE simulation_id = $1",
      [simulationId],
    );

    expect(formalSchemas.rows[0]?.simulation_table).toBeNull();
    expect(simulationSchemas.rows[0]?.app_schema).toBeNull();
    expect(formalIdentifiers.rows[0]?.count).toBe(0);
    expect(clock.rows[0]?.owner_id).toBe(ownerId);
    expect(new Date(String(clock.rows[0]?.current_at)).toISOString()).toBe(startAt);
  });

  it("advances persisted simulation time without replacing the formal database clock", async () => {
    const store = new PostgresSimulationStore(simulation);
    const formalClient = await formal.connect();
    try {
      const formalClock = new PgDatabaseClock(formalClient);
      const before = await formalClock.now();
      const result = await advanceSimulation(
        {
          simulationId,
          ownerId,
          idempotencyKey: "publish-once",
          target: "PUBLICATION",
        },
        { store },
      );
      const after = await formalClock.now();

      expect(result.currentAt).toBe("2026-08-17T00:00:00.000Z");
      expect(Date.parse(after) - Date.parse(before)).toBeLessThan(10_000);
    } finally {
      formalClient.release();
    }
  });

  it("persists one audit and one replayable idempotent result across store instances", async () => {
    const firstStore = new PostgresSimulationStore(simulation);
    const first = await advanceSimulation(
      {
        simulationId,
        ownerId,
        idempotencyKey: "smtp-retry-once",
        target: "SMTP_RETRY",
      },
      { store: firstStore },
    );
    const secondStore = new PostgresSimulationStore(simulation);
    const replay = await advanceSimulation(
      {
        simulationId,
        ownerId,
        idempotencyKey: "smtp-retry-once",
        target: "SMTP_RETRY",
      },
      { store: secondStore },
    );
    const records = await simulation.query(
      "SELECT event_type FROM simulation.audit_events WHERE event_type = 'simulation.advanced' AND payload ->> 'target' = 'SMTP_RETRY'",
    );

    expect(replay).toEqual(first);
    expect(records.rowCount).toBe(1);
  });
});

describe("simulation configuration fail-closed rules", () => {
  it("rejects production enablement, shared databases, external SMTP, and empty allowlists", () => {
    const base = {
      NODE_ENV: "test",
      DLS_TEST_MODE: "true",
      DLS_SIMULATION_MODE: "enabled",
      DATABASE_URL: formalUrl,
      SIMULATION_DATABASE_URL: simulationUrl,
      SIMULATION_STORAGE_ROOT: "D:/dls-test/simulations",
      MAIL_TRANSPORT_URL: "smtp://mailpit:1025",
      SIMULATION_MAIL_ALLOWLIST: "*@example.test",
    };

    expect(() => getSimulationRuntimeConfig({ ...base, NODE_ENV: "production" })).toThrow(
      /test environment/u,
    );
    expect(() =>
      getSimulationRuntimeConfig({ ...base, SIMULATION_DATABASE_URL: formalUrl }),
    ).toThrow(/separate database/u);
    expect(() =>
      getSimulationRuntimeConfig({ ...base, MAIL_TRANSPORT_URL: "smtp://smtp.example.com:25" }),
    ).toThrow(/Mailpit/u);
    expect(() => getSimulationRuntimeConfig({ ...base, SIMULATION_MAIL_ALLOWLIST: "" })).toThrow(
      /allowlist/u,
    );
  });
});
