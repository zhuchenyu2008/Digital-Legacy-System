DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dls_api') THEN
    REVOKE USAGE, SELECT ON SEQUENCE audit.private_events_sequence_no_seq FROM dls_api;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dls_worker') THEN
    REVOKE USAGE, SELECT ON SEQUENCE audit.private_events_sequence_no_seq FROM dls_worker;
  END IF;
END $$;
