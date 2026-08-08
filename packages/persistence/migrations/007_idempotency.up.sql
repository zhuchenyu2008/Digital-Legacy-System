CREATE TABLE app.idempotency_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_scope text NOT NULL,
  command_name text NOT NULL,
  key_digest bytea NOT NULL,
  request_hash bytea NOT NULL,
  status text NOT NULL CHECK (status IN ('IN_PROGRESS', 'COMPLETED', 'FAILED')),
  response_status smallint,
  response_body jsonb,
  response_hash bytea,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  UNIQUE (actor_scope, command_name, key_digest),
  CHECK ((status = 'COMPLETED') = (response_status IS NOT NULL AND response_body IS NOT NULL AND response_hash IS NOT NULL AND completed_at IS NOT NULL))
);
