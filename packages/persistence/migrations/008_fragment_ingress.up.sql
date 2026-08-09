ALTER TABLE app.workflow_key_fragments
  ALTER COLUMN fragment_ciphertext DROP NOT NULL,
  ALTER COLUMN fragment_nonce DROP NOT NULL,
  ADD COLUMN share_index smallint,
  ADD COLUMN fragment_commitment_digest bytea,
  ADD COLUMN status text NOT NULL DEFAULT 'PENDING',
  ADD COLUMN ingress_key_version smallint NOT NULL DEFAULT 1,
  ADD COLUMN stage_key_version smallint,
  ADD COLUMN protocol_version smallint NOT NULL DEFAULT 1,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ADD COLUMN version bigint NOT NULL DEFAULT 0;

UPDATE app.workflow_key_fragments AS fragment
SET share_index = share.share_index,
    fragment_commitment_digest = digest(fragment.fragment_commitment, 'sha256')
FROM app.contact_key_shares AS share
WHERE share.generation_id = fragment.generation_id
  AND share.contact_id = fragment.contact_id;

ALTER TABLE app.workflow_key_fragments
  ALTER COLUMN share_index SET NOT NULL,
  ALTER COLUMN fragment_commitment_digest SET NOT NULL,
  ADD CONSTRAINT workflow_key_fragments_status_check
    CHECK (status IN ('PENDING', 'VALIDATED', 'REJECTED', 'DESTROYED')),
  ADD CONSTRAINT workflow_key_fragments_ingress_version_check
    CHECK (ingress_key_version > 0),
  ADD CONSTRAINT workflow_key_fragments_stage_version_check
    CHECK (stage_key_version IS NULL OR stage_key_version > 0),
  ADD CONSTRAINT workflow_key_fragments_protocol_version_check
    CHECK (protocol_version = 1),
  ADD CONSTRAINT workflow_key_fragments_share_index_check
    CHECK (share_index > 0),
  ADD CONSTRAINT workflow_key_fragments_version_check
    CHECK (version >= 0),
  ADD CONSTRAINT workflow_key_fragments_representation_check
    CHECK (
      (status = 'PENDING'
        AND fragment_ciphertext IS NOT NULL
        AND fragment_nonce IS NOT NULL
        AND stage_key_version IS NULL)
      OR
      (status = 'VALIDATED'
        AND fragment_ciphertext IS NOT NULL
        AND fragment_nonce IS NOT NULL
        AND stage_key_version IS NOT NULL)
      OR
      (status IN ('REJECTED', 'DESTROYED')
        AND fragment_ciphertext IS NULL
        AND fragment_nonce IS NULL
        AND stage_key_version IS NULL)
    );

ALTER TABLE app.workflow_key_fragments
  ALTER COLUMN status DROP DEFAULT,
  ALTER COLUMN ingress_key_version DROP DEFAULT,
  ALTER COLUMN protocol_version DROP DEFAULT;
