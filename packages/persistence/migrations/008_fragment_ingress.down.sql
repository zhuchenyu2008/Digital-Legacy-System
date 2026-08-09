DELETE FROM app.workflow_key_fragments
WHERE status <> 'PENDING';

ALTER TABLE app.workflow_key_fragments
  DROP CONSTRAINT workflow_key_fragments_representation_check,
  DROP CONSTRAINT workflow_key_fragments_version_check,
  DROP CONSTRAINT workflow_key_fragments_share_index_check,
  DROP CONSTRAINT workflow_key_fragments_protocol_version_check,
  DROP CONSTRAINT workflow_key_fragments_stage_version_check,
  DROP CONSTRAINT workflow_key_fragments_ingress_version_check,
  DROP CONSTRAINT workflow_key_fragments_status_check,
  DROP COLUMN version,
  DROP COLUMN updated_at,
  DROP COLUMN protocol_version,
  DROP COLUMN stage_key_version,
  DROP COLUMN ingress_key_version,
  DROP COLUMN status,
  DROP COLUMN fragment_commitment_digest,
  DROP COLUMN share_index,
  ALTER COLUMN fragment_nonce SET NOT NULL,
  ALTER COLUMN fragment_ciphertext SET NOT NULL;
