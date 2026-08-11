DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dls_api') THEN
    GRANT USAGE, SELECT ON SEQUENCE audit.private_events_sequence_no_seq TO dls_api;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dls_worker') THEN
    GRANT USAGE, SELECT ON SEQUENCE audit.private_events_sequence_no_seq TO dls_worker;
  END IF;
END $$;
