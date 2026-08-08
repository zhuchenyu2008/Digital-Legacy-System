CREATE TABLE app.vaults (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_vault_envelope bytea NOT NULL,
  owner_envelope_nonce bytea NOT NULL,
  owner_envelope_algorithm text NOT NULL,
  owner_envelope_protocol_version smallint NOT NULL,
  owner_envelope_aad_hash bytea NOT NULL,
  owner_kdf_salt bytea NOT NULL,
  owner_kdf_params jsonb NOT NULL,
  vk_commitment bytea NOT NULL,
  key_verifier_ciphertext bytea NOT NULL,
  key_verifier_nonce bytea NOT NULL,
  active_share_generation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0)
);

CREATE TABLE app.share_generations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vault_id uuid NOT NULL REFERENCES app.vaults(id),
  generation_no integer NOT NULL CHECK (generation_no >= 1),
  contact_count integer NOT NULL CHECK (contact_count >= 3),
  death_threshold integer NOT NULL,
  recovery_threshold integer NOT NULL,
  contacts_snapshot_sha256 bytea NOT NULL,
  protocol_version smallint NOT NULL,
  vss_scheme text NOT NULL,
  generation_commitment bytea NOT NULL,
  status text NOT NULL CHECK (status IN ('PREPARING', 'ACTIVE', 'RETIRED')),
  activated_at timestamptz,
  retired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (vault_id, generation_no),
  CHECK (death_threshold BETWEEN 2 AND contact_count),
  CHECK (recovery_threshold BETWEEN 2 AND contact_count)
);

ALTER TABLE app.vaults
  ADD CONSTRAINT vaults_active_share_generation_fk
  FOREIGN KEY (active_share_generation_id) REFERENCES app.share_generations(id);

CREATE TABLE app.contact_key_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  generation_id uuid NOT NULL REFERENCES app.share_generations(id),
  contact_id uuid NOT NULL REFERENCES app.emergency_contacts(id),
  share_index smallint NOT NULL CHECK (share_index > 0),
  death_share_ciphertext bytea NOT NULL,
  recovery_share_ciphertext bytea NOT NULL,
  share_protocol_version smallint NOT NULL,
  death_share_commitment bytea NOT NULL,
  recovery_share_commitment bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (generation_id, contact_id),
  UNIQUE (generation_id, share_index)
);

CREATE TABLE app.legacy_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_no integer NOT NULL UNIQUE CHECK (version_no >= 1),
  status app.package_status NOT NULL DEFAULT 'UPLOADING',
  object_key text NOT NULL UNIQUE,
  upload_id text,
  cipher_algorithm text NOT NULL,
  stream_header bytea NOT NULL,
  ciphertext_size bigint NOT NULL CHECK (ciphertext_size >= 0),
  ciphertext_sha256 bytea NOT NULL,
  dek_envelope bytea NOT NULL,
  dek_envelope_nonce bytea NOT NULL,
  dek_envelope_algorithm text NOT NULL,
  dek_envelope_protocol_version smallint NOT NULL,
  dek_envelope_aad_hash bytea NOT NULL,
  manifest_ciphertext bytea NOT NULL,
  manifest_nonce bytea NOT NULL,
  manifest_algorithm text NOT NULL,
  manifest_aad_hash bytea NOT NULL,
  uploaded_at timestamptz,
  ready_at timestamptz,
  activated_at timestamptz,
  superseded_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0)
);

CREATE TABLE app.check_ins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  beijing_date date NOT NULL,
  checked_in_at timestamptz NOT NULL,
  source text NOT NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('OWNER', 'CONTACT')),
  actor_ref uuid,
  workflow_id uuid,
  request_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE app.checkin_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_version bigint NOT NULL UNIQUE CHECK (schedule_version >= 1),
  last_check_in_id uuid NOT NULL REFERENCES app.check_ins(id),
  threshold_days integer NOT NULL CHECK (threshold_days >= 1),
  deadline_at timestamptz NOT NULL,
  reminder_24h_at timestamptz,
  reminder_12h_at timestamptz,
  reminder_5h_at timestamptz,
  reminder_1h_at timestamptz,
  status text NOT NULL CHECK (status IN ('ACTIVE', 'SATISFIED', 'TRIGGERED', 'SUPERSEDED')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
