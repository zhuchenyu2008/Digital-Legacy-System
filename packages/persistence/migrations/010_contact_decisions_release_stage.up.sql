ALTER TABLE app.workflow_key_fragments
  ADD COLUMN decision_digest bytea;

UPDATE app.workflow_key_fragments
SET decision_digest = digest('legacy-workflow-fragment:' || id::text, 'sha256')
WHERE decision_digest IS NULL;

ALTER TABLE app.workflow_key_fragments
  ALTER COLUMN decision_digest SET NOT NULL,
  ADD CONSTRAINT workflow_key_fragments_decision_digest_length
    CHECK (octet_length(decision_digest) = 32);

ALTER TABLE app.release_secret_sessions
  ALTER COLUMN stage_key_envelope DROP NOT NULL,
  ALTER COLUMN stage_key_nonce DROP NOT NULL,
  ADD COLUMN stage_key_version smallint NOT NULL DEFAULT 1,
  ADD COLUMN status text NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ADD COLUMN version bigint NOT NULL DEFAULT 0;

ALTER TABLE app.release_secret_sessions
  ALTER COLUMN stage_key_version DROP DEFAULT,
  ALTER COLUMN status DROP DEFAULT,
  ADD CONSTRAINT release_secret_sessions_stage_key_version_check
    CHECK (stage_key_version > 0),
  ADD CONSTRAINT release_secret_sessions_status_check
    CHECK (status IN ('ACTIVE', 'CONSUMED', 'DESTROYED')),
  ADD CONSTRAINT release_secret_sessions_version_check
    CHECK (version >= 0),
  ADD CONSTRAINT release_secret_sessions_representation_check
    CHECK (
      (status = 'ACTIVE'
        AND stage_key_envelope IS NOT NULL
        AND stage_key_nonce IS NOT NULL
        AND consumed_at IS NULL)
      OR
      (status IN ('CONSUMED', 'DESTROYED')
        AND stage_key_envelope IS NULL
        AND stage_key_nonce IS NULL
        AND consumed_at IS NOT NULL)
    );
