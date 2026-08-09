DELETE FROM app.email_verification_codes WHERE notification_id IS NULL;

ALTER TABLE app.email_verification_codes
  DROP CONSTRAINT email_verification_codes_version_check,
  DROP COLUMN version,
  DROP COLUMN updated_at,
  ALTER COLUMN notification_id SET NOT NULL;

DELETE FROM app.password_rewrap_sessions
WHERE replacement_owner_envelope IS NULL
   OR replacement_envelope_nonce IS NULL
   OR replacement_envelope_protocol_version IS NULL;

ALTER TABLE app.password_rewrap_sessions
  DROP CONSTRAINT password_rewrap_sessions_version_check,
  DROP CONSTRAINT password_rewrap_sessions_status_check,
  DROP CONSTRAINT password_rewrap_sessions_sealed_digest_check,
  DROP CONSTRAINT password_rewrap_sessions_ephemeral_key_check,
  DROP CONSTRAINT password_rewrap_sessions_token_version_check,
  DROP CONSTRAINT password_rewrap_sessions_token_hash_unique,
  DROP COLUMN version,
  DROP COLUMN updated_at,
  DROP COLUMN status,
  DROP COLUMN sealed_vault_key_digest,
  DROP COLUMN client_ephemeral_public_key,
  DROP COLUMN token_hmac_key_version,
  DROP COLUMN reset_token_hash,
  ALTER COLUMN replacement_owner_envelope SET NOT NULL,
  ALTER COLUMN replacement_envelope_nonce SET NOT NULL,
  ALTER COLUMN replacement_envelope_protocol_version SET NOT NULL;

DROP TABLE app.recovery_secret_sessions;
