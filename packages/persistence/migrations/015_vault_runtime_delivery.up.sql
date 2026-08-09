ALTER TABLE app.legacy_packages
  ADD COLUMN vault_id uuid REFERENCES app.vaults(id),
  ADD COLUMN share_generation_id uuid REFERENCES app.share_generations(id),
  ADD COLUMN expires_at timestamptz,
  ADD COLUMN client_crypto_version text,
  ADD COLUMN failure_reason text,
  ADD COLUMN storage_metadata jsonb;

UPDATE app.legacy_packages AS package
SET vault_id = COALESCE(
      package.vault_id,
      (SELECT generation.vault_id
       FROM app.workflows AS workflow
       JOIN app.share_generations AS generation ON generation.id = workflow.share_generation_id
       WHERE workflow.package_id = package.id
       ORDER BY workflow.started_at DESC
       LIMIT 1),
      (SELECT vault.id FROM app.vaults AS vault ORDER BY vault.created_at LIMIT 1)
    ),
    share_generation_id = COALESCE(
      package.share_generation_id,
      (SELECT workflow.share_generation_id
       FROM app.workflows AS workflow
       WHERE workflow.package_id = package.id
       ORDER BY workflow.started_at DESC
       LIMIT 1),
      (SELECT vault.active_share_generation_id
       FROM app.vaults AS vault
       WHERE vault.active_share_generation_id IS NOT NULL
       ORDER BY vault.created_at
       LIMIT 1)
    ),
    expires_at = COALESCE(package.expires_at, package.created_at + interval '15 minutes'),
    client_crypto_version = COALESCE(package.client_crypto_version, 'pre-runtime-v1');

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM app.legacy_packages
    WHERE vault_id IS NULL OR share_generation_id IS NULL
  ) THEN
    RAISE EXCEPTION 'legacy package rows cannot be bound to a vault/share generation';
  END IF;
END $$;

ALTER TABLE app.legacy_packages
  ALTER COLUMN vault_id SET NOT NULL,
  ALTER COLUMN share_generation_id SET NOT NULL,
  ALTER COLUMN expires_at SET NOT NULL,
  ALTER COLUMN client_crypto_version SET NOT NULL;

CREATE INDEX idx_packages_vault_version
  ON app.legacy_packages (vault_id, version_no DESC);
