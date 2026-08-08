CREATE TABLE app.owner_profile (
  singleton_id boolean PRIMARY KEY DEFAULT true CHECK (singleton_id),
  display_name_ciphertext bytea NOT NULL,
  display_name_nonce bytea NOT NULL,
  display_name_key_version smallint NOT NULL,
  primary_email_ciphertext bytea NOT NULL,
  primary_email_nonce bytea NOT NULL,
  primary_email_key_version smallint NOT NULL,
  primary_email_lookup_hmac bytea NOT NULL UNIQUE,
  backup_email_ciphertext bytea,
  backup_email_nonce bytea,
  backup_email_key_version smallint,
  backup_email_lookup_hmac bytea UNIQUE,
  setup_state text NOT NULL DEFAULT 'INCOMPLETE' CHECK (setup_state IN ('INCOMPLETE', 'READY', 'ARMED')),
  irreversibility_accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  CHECK ((backup_email_ciphertext IS NULL) = (backup_email_nonce IS NULL) AND (backup_email_nonce IS NULL) = (backup_email_key_version IS NULL) AND (backup_email_key_version IS NULL) = (backup_email_lookup_hmac IS NULL)),
  CHECK (backup_email_lookup_hmac IS NULL OR backup_email_lookup_hmac <> primary_email_lookup_hmac)
);

CREATE TABLE app.owner_credentials (
  singleton_id boolean PRIMARY KEY REFERENCES app.owner_profile(singleton_id),
  password_phc text NOT NULL,
  password_changed_at timestamptz NOT NULL,
  password_pepper_version smallint NOT NULL,
  password_kdf_version smallint NOT NULL,
  password_normalization_version smallint NOT NULL,
  failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until timestamptz,
  credential_version bigint NOT NULL DEFAULT 0 CHECK (credential_version >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE app.system_settings (
  singleton_id boolean PRIMARY KEY DEFAULT true CHECK (singleton_id),
  timezone text NOT NULL DEFAULT 'Asia/Shanghai' CHECK (timezone = 'Asia/Shanghai'),
  missed_days_threshold integer NOT NULL DEFAULT 3 CHECK (missed_days_threshold >= 1),
  contact_consent_version text NOT NULL,
  contact_consent_sha256 bytea NOT NULL,
  public_base_url text NOT NULL,
  test_recipient_allowlist_ciphertext bytea,
  contact_set_version bigint NOT NULL DEFAULT 0 CHECK (contact_set_version >= 0),
  settings_version bigint NOT NULL DEFAULT 0 CHECK (settings_version >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE app.emergency_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status app.contact_status NOT NULL DEFAULT 'INVITED',
  display_name_ciphertext bytea NOT NULL,
  display_name_nonce bytea NOT NULL,
  display_name_key_version smallint NOT NULL,
  display_name_lookup_hmac bytea NOT NULL,
  email_ciphertext bytea NOT NULL,
  email_nonce bytea NOT NULL,
  email_key_version smallint NOT NULL,
  email_lookup_hmac bytea NOT NULL,
  password_phc text,
  password_changed_at timestamptz,
  password_pepper_version smallint,
  password_kdf_version smallint,
  password_normalization_version smallint,
  credential_version bigint NOT NULL DEFAULT 0 CHECK (credential_version >= 0),
  x25519_public_key bytea,
  private_key_ciphertext bytea,
  private_key_nonce bytea,
  private_key_kdf_salt bytea,
  private_key_kdf_params jsonb,
  registered_at timestamptz,
  removed_at timestamptz,
  active_share_generation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  CHECK (status <> 'REMOVED' OR removed_at IS NOT NULL),
  CHECK (status = 'INVITED' OR (registered_at IS NOT NULL AND password_phc IS NOT NULL AND x25519_public_key IS NOT NULL)),
  CHECK (status <> 'ACTIVE' OR active_share_generation_id IS NOT NULL)
);

CREATE TABLE app.contact_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL REFERENCES app.emergency_contacts(id),
  token_hash bytea NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  revoked_at timestamptz,
  notification_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (NOT (consumed_at IS NOT NULL AND revoked_at IS NOT NULL))
);

CREATE TABLE app.contact_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL REFERENCES app.emergency_contacts(id),
  consent_version text NOT NULL,
  document_sha256 bytea NOT NULL,
  terms_accepted boolean NOT NULL CHECK (terms_accepted),
  privacy_accepted boolean NOT NULL CHECK (privacy_accepted),
  denial_disclosure_accepted boolean NOT NULL CHECK (denial_disclosure_accepted),
  stage2_lock_accepted boolean NOT NULL CHECK (stage2_lock_accepted),
  accepted_at timestamptz NOT NULL,
  ip_ciphertext bytea NOT NULL,
  ip_nonce bytea NOT NULL,
  ip_key_version smallint NOT NULL,
  user_agent_ciphertext bytea NOT NULL,
  user_agent_nonce bytea NOT NULL,
  user_agent_key_version smallint NOT NULL
);
