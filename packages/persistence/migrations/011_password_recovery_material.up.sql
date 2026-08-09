CREATE TABLE app.recovery_secret_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL UNIQUE REFERENCES app.workflows(id),
  stage_key_envelope bytea,
  stage_key_nonce bytea,
  stage_key_protocol_version smallint NOT NULL CHECK (stage_key_protocol_version = 1),
  stage_key_version smallint NOT NULL CHECK (stage_key_version > 0),
  vault_key_commitment bytea NOT NULL CHECK (octet_length(vault_key_commitment) = 32),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'DESTROYED')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  CHECK (
    (status = 'ACTIVE' AND stage_key_envelope IS NOT NULL
      AND stage_key_nonce IS NOT NULL AND consumed_at IS NULL)
    OR
    (status = 'DESTROYED' AND stage_key_envelope IS NULL
      AND stage_key_nonce IS NULL AND consumed_at IS NOT NULL)
  )
);

ALTER TABLE app.password_rewrap_sessions
  ALTER COLUMN replacement_owner_envelope DROP NOT NULL,
  ALTER COLUMN replacement_envelope_nonce DROP NOT NULL,
  ALTER COLUMN replacement_envelope_protocol_version DROP NOT NULL,
  ADD COLUMN reset_token_hash bytea,
  ADD COLUMN token_hmac_key_version smallint,
  ADD COLUMN client_ephemeral_public_key bytea,
  ADD COLUMN sealed_vault_key_digest bytea,
  ADD COLUMN status text,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ADD COLUMN version bigint NOT NULL DEFAULT 0;

UPDATE app.password_rewrap_sessions
SET reset_token_hash = digest('legacy-password-rewrap:' || id::text, 'sha256'),
    token_hmac_key_version = 1,
    client_ephemeral_public_key = decode(repeat('00', 32), 'hex'),
    sealed_vault_key_digest = digest('legacy-sealed-vault-key:' || id::text, 'sha256'),
    status = 'ACTIVE';

ALTER TABLE app.password_rewrap_sessions
  ALTER COLUMN reset_token_hash SET NOT NULL,
  ALTER COLUMN token_hmac_key_version SET NOT NULL,
  ALTER COLUMN client_ephemeral_public_key SET NOT NULL,
  ALTER COLUMN sealed_vault_key_digest SET NOT NULL,
  ALTER COLUMN status SET NOT NULL,
  ADD CONSTRAINT password_rewrap_sessions_token_hash_unique UNIQUE (reset_token_hash),
  ADD CONSTRAINT password_rewrap_sessions_token_version_check CHECK (token_hmac_key_version > 0),
  ADD CONSTRAINT password_rewrap_sessions_ephemeral_key_check
    CHECK (octet_length(client_ephemeral_public_key) = 32),
  ADD CONSTRAINT password_rewrap_sessions_sealed_digest_check
    CHECK (octet_length(sealed_vault_key_digest) = 32),
  ADD CONSTRAINT password_rewrap_sessions_status_check
    CHECK (status IN ('ACTIVE', 'CONSUMED', 'DESTROYED')),
  ADD CONSTRAINT password_rewrap_sessions_version_check CHECK (version >= 0);

ALTER TABLE app.email_verification_codes
  ALTER COLUMN notification_id DROP NOT NULL,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ADD COLUMN version bigint NOT NULL DEFAULT 0,
  ADD CONSTRAINT email_verification_codes_version_check CHECK (version >= 0);
