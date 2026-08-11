ALTER TABLE app.auth_sessions
  DROP COLUMN IF EXISTS csrf_token_hash;
