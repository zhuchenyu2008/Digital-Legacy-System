DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dls_api') THEN
    GRANT SELECT, INSERT, UPDATE
      ON app.idempotency_records, app.recovery_secret_sessions
      TO dls_api;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dls_worker') THEN
    GRANT SELECT, INSERT, UPDATE
      ON app.idempotency_records, app.recovery_secret_sessions
      TO dls_worker;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dls_backup') THEN
    GRANT SELECT
      ON app.idempotency_records, app.recovery_secret_sessions
      TO dls_backup;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dls_migrator')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dls_api') THEN
    ALTER DEFAULT PRIVILEGES FOR ROLE dls_migrator IN SCHEMA app
      GRANT SELECT, INSERT, UPDATE ON TABLES TO dls_api;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dls_migrator')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dls_worker') THEN
    ALTER DEFAULT PRIVILEGES FOR ROLE dls_migrator IN SCHEMA app
      GRANT SELECT, INSERT, UPDATE ON TABLES TO dls_worker;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dls_migrator')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dls_backup') THEN
    ALTER DEFAULT PRIVILEGES FOR ROLE dls_migrator IN SCHEMA app
      GRANT SELECT ON TABLES TO dls_backup;
  END IF;
END $$;
