DELETE FROM app.auth_sessions;

ALTER TABLE app.auth_sessions
  ADD COLUMN csrf_token_hash bytea NOT NULL;
