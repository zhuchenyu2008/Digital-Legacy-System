ALTER TABLE app.publications
  ADD COLUMN owner_display_name text NOT NULL DEFAULT '数字遗产所有者';

ALTER TABLE app.publications
  ALTER COLUMN owner_display_name DROP DEFAULT,
  ADD CONSTRAINT publications_owner_display_name_check
    CHECK (char_length(owner_display_name) BETWEEN 1 AND 200);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dls_api') THEN
    GRANT SELECT ON audit.public_events TO dls_api;
    REVOKE UPDATE, DELETE ON app.publications FROM dls_api;
    REVOKE UPDATE, DELETE ON audit.public_events FROM dls_api;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dls_worker') THEN
    REVOKE UPDATE, DELETE ON app.publications FROM dls_worker;
    REVOKE UPDATE, DELETE ON audit.public_events FROM dls_worker;
  END IF;
END $$;
