ALTER TABLE app.worker_heartbeats
  DROP CONSTRAINT worker_heartbeats_service_check,
  ADD CONSTRAINT worker_heartbeats_service_check
    CHECK (service IN ('worker', 'deadline-scanner'));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dls_worker') THEN
    GRANT SELECT, INSERT, UPDATE ON app.worker_heartbeats TO dls_worker;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dls_api') THEN
    GRANT SELECT ON app.worker_heartbeats TO dls_api;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dls_health') THEN
    GRANT SELECT ON
      app.checkin_schedules,
      app.workflows,
      app.notifications,
      app.notification_attempts,
      app.domain_outbox,
      app.worker_heartbeats
    TO dls_health;
  END IF;
END $$;
