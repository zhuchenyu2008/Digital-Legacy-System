DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dls_api') THEN
    REVOKE SELECT ON audit.private_events FROM dls_api;
  END IF;
END $$;
