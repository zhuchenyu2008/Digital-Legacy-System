DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'pgboss') THEN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dls_migrator') THEN
      EXECUTE 'CREATE SCHEMA pgboss AUTHORIZATION dls_migrator';
    ELSE
      CREATE SCHEMA pgboss;
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dls_worker') THEN
    GRANT USAGE ON SCHEMA pgboss TO dls_worker;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pgboss TO dls_worker;
    GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA pgboss TO dls_worker;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pgboss TO dls_worker;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dls_migrator')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dls_worker') THEN
    ALTER DEFAULT PRIVILEGES FOR ROLE dls_migrator IN SCHEMA pgboss
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO dls_worker;
    ALTER DEFAULT PRIVILEGES FOR ROLE dls_migrator IN SCHEMA pgboss
      GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO dls_worker;
    ALTER DEFAULT PRIVILEGES FOR ROLE dls_migrator IN SCHEMA pgboss
      GRANT EXECUTE ON FUNCTIONS TO dls_worker;
  END IF;
END $$;
