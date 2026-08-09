DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dls_worker')
     AND EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'pgboss') THEN
    REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA pgboss FROM dls_worker;
    REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA pgboss FROM dls_worker;
    REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA pgboss FROM dls_worker;
    REVOKE USAGE ON SCHEMA pgboss FROM dls_worker;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dls_migrator')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dls_worker') THEN
    ALTER DEFAULT PRIVILEGES FOR ROLE dls_migrator IN SCHEMA pgboss
      REVOKE ALL ON TABLES FROM dls_worker;
    ALTER DEFAULT PRIVILEGES FOR ROLE dls_migrator IN SCHEMA pgboss
      REVOKE ALL ON SEQUENCES FROM dls_worker;
    ALTER DEFAULT PRIVILEGES FOR ROLE dls_migrator IN SCHEMA pgboss
      REVOKE ALL ON FUNCTIONS FROM dls_worker;
  END IF;
END $$;
