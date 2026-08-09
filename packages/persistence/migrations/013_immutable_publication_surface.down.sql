DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dls_api') THEN
    REVOKE SELECT ON audit.public_events FROM dls_api;
    GRANT UPDATE ON app.publications TO dls_api;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dls_worker') THEN
    GRANT UPDATE ON app.publications TO dls_worker;
  END IF;
END $$;

ALTER TABLE app.publications
  DROP CONSTRAINT publications_owner_display_name_check,
  DROP COLUMN owner_display_name;
