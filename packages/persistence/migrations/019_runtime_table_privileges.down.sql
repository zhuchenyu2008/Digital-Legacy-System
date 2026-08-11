DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dls_migrator')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dls_api') THEN
    ALTER DEFAULT PRIVILEGES FOR ROLE dls_migrator IN SCHEMA app
      REVOKE SELECT, INSERT, UPDATE ON TABLES FROM dls_api;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dls_migrator')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dls_worker') THEN
    ALTER DEFAULT PRIVILEGES FOR ROLE dls_migrator IN SCHEMA app
      REVOKE SELECT, INSERT, UPDATE ON TABLES FROM dls_worker;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dls_migrator')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dls_backup') THEN
    ALTER DEFAULT PRIVILEGES FOR ROLE dls_migrator IN SCHEMA app
      REVOKE SELECT ON TABLES FROM dls_backup;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dls_api') THEN
    REVOKE SELECT, INSERT, UPDATE
      ON app.idempotency_records, app.recovery_secret_sessions
      FROM dls_api;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dls_worker') THEN
    REVOKE SELECT, INSERT, UPDATE
      ON app.idempotency_records, app.recovery_secret_sessions
      FROM dls_worker;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dls_backup') THEN
    REVOKE SELECT
      ON app.idempotency_records, app.recovery_secret_sessions
      FROM dls_backup;
  END IF;
END $$;
