DROP INDEX IF EXISTS app.idx_packages_vault_version;

ALTER TABLE app.legacy_packages
  DROP COLUMN IF EXISTS storage_metadata,
  DROP COLUMN IF EXISTS failure_reason,
  DROP COLUMN IF EXISTS client_crypto_version,
  DROP COLUMN IF EXISTS expires_at,
  DROP COLUMN IF EXISTS share_generation_id,
  DROP COLUMN IF EXISTS vault_id;
