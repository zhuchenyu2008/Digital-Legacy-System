DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dls_api') THEN
    GRANT SELECT ON audit.private_events TO dls_api;
  END IF;
END $$;
