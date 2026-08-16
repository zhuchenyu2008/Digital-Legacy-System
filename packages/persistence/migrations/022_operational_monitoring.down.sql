ALTER TABLE app.worker_heartbeats
  DROP CONSTRAINT worker_heartbeats_service_check,
  ADD CONSTRAINT worker_heartbeats_service_check CHECK (service = 'worker');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dls_worker') THEN
    REVOKE SELECT, INSERT, UPDATE ON app.worker_heartbeats FROM dls_worker;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dls_api') THEN
    REVOKE SELECT ON app.worker_heartbeats FROM dls_api;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dls_health') THEN
    REVOKE SELECT ON
      app.workflows,
      app.notification_attempts,
      app.domain_outbox,
      app.worker_heartbeats
    FROM dls_health;
  END IF;
END $$;
