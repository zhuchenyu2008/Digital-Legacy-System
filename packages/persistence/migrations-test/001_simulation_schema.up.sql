CREATE SCHEMA simulation;

CREATE TABLE simulation.scenarios (
  simulation_id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  namespace text NOT NULL UNIQUE CHECK (namespace LIKE 'simulation:%'),
  revision integer NOT NULL CHECK (revision >= 0),
  document jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE simulation.clock_state (
  simulation_id uuid PRIMARY KEY REFERENCES simulation.scenarios(simulation_id) ON DELETE CASCADE,
  owner_id uuid NOT NULL,
  start_at timestamptz NOT NULL,
  current_at timestamptz NOT NULL,
  state text NOT NULL,
  revision integer NOT NULL CHECK (revision >= 0),
  CHECK (current_at >= start_at)
);

CREATE TABLE simulation.idempotency_results (
  simulation_id uuid NOT NULL REFERENCES simulation.scenarios(simulation_id) ON DELETE CASCADE,
  idempotency_key text NOT NULL CHECK (length(idempotency_key) >= 8),
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (simulation_id, idempotency_key)
);

CREATE TABLE simulation.audit_events (
  event_id text PRIMARY KEY,
  simulation_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  event_type text NOT NULL,
  occurred_at timestamptz NOT NULL,
  payload jsonb NOT NULL
);

CREATE INDEX simulation_audit_events_simulation_occurred_idx
  ON simulation.audit_events (simulation_id, occurred_at, event_id);
