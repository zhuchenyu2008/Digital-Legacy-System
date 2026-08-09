ALTER TABLE app.release_secret_sessions
  DROP CONSTRAINT release_secret_sessions_representation_check,
  DROP CONSTRAINT release_secret_sessions_version_check,
  DROP CONSTRAINT release_secret_sessions_status_check,
  DROP CONSTRAINT release_secret_sessions_stage_key_version_check;

DELETE FROM app.release_secret_sessions
WHERE stage_key_envelope IS NULL OR stage_key_nonce IS NULL;

ALTER TABLE app.release_secret_sessions
  ALTER COLUMN stage_key_envelope SET NOT NULL,
  ALTER COLUMN stage_key_nonce SET NOT NULL,
  DROP COLUMN version,
  DROP COLUMN updated_at,
  DROP COLUMN status,
  DROP COLUMN stage_key_version;

ALTER TABLE app.workflow_key_fragments
  DROP CONSTRAINT workflow_key_fragments_decision_digest_length,
  DROP COLUMN decision_digest;
