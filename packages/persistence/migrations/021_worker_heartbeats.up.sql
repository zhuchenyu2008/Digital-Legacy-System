CREATE TABLE app.worker_heartbeats (
  service text PRIMARY KEY CHECK (service = 'worker'),
  last_seen_at timestamptz NOT NULL,
  version text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX worker_heartbeats_last_seen_idx ON app.worker_heartbeats (last_seen_at);
