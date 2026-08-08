CREATE TABLE app.workflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind app.workflow_kind NOT NULL,
  state app.workflow_state NOT NULL,
  contact_count_snapshot integer NOT NULL CHECK (contact_count_snapshot >= 1),
  required_count_snapshot integer NOT NULL CHECK (required_count_snapshot >= 1 AND required_count_snapshot <= contact_count_snapshot),
  approved_count integer NOT NULL DEFAULT 0 CHECK (approved_count >= 0 AND approved_count <= contact_count_snapshot),
  share_generation_id uuid NOT NULL REFERENCES app.share_generations(id),
  package_id uuid REFERENCES app.legacy_packages(id),
  started_at timestamptz NOT NULL,
  expires_at timestamptz,
  release_at timestamptz,
  publish_locked_at timestamptz,
  ended_at timestamptz,
  end_reason text,
  denying_contact_id uuid REFERENCES app.emergency_contacts(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  CHECK ((kind = 'PASSWORD_RECOVERY' AND expires_at IS NOT NULL) OR kind = 'DEATH_CONFIRMATION'),
  CHECK (publish_locked_at IS NULL OR state IN ('RELEASE_PENDING', 'RELEASED'))
);

CREATE TABLE app.workflow_contacts (
  workflow_id uuid NOT NULL REFERENCES app.workflows(id),
  contact_id uuid NOT NULL REFERENCES app.emergency_contacts(id),
  snapshot_position smallint NOT NULL CHECK (snapshot_position > 0),
  contact_public_key bytea NOT NULL,
  contact_set_version bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (workflow_id, contact_id),
  UNIQUE (workflow_id, snapshot_position)
);

CREATE TABLE app.workflow_contact_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL REFERENCES app.workflows(id),
  contact_id uuid NOT NULL REFERENCES app.emergency_contacts(id),
  decision app.workflow_decision NOT NULL,
  decision_digest bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (workflow_id, contact_id)
);

CREATE TABLE app.workflow_key_fragments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL REFERENCES app.workflows(id),
  contact_id uuid NOT NULL REFERENCES app.emergency_contacts(id),
  purpose text NOT NULL CHECK (purpose IN ('DEATH', 'RECOVERY')),
  generation_id uuid NOT NULL REFERENCES app.share_generations(id),
  fragment_ciphertext bytea NOT NULL,
  fragment_nonce bytea NOT NULL,
  fragment_commitment bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (workflow_id, contact_id, purpose)
);

CREATE TABLE app.release_secret_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL UNIQUE REFERENCES app.workflows(id),
  stage_key_envelope bytea NOT NULL,
  stage_key_nonce bytea NOT NULL,
  stage_key_protocol_version smallint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);

CREATE TABLE app.password_rewrap_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL UNIQUE REFERENCES app.workflows(id),
  replacement_owner_envelope bytea NOT NULL,
  replacement_envelope_nonce bytea NOT NULL,
  replacement_envelope_protocol_version smallint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  completed_at timestamptz
);

CREATE TABLE app.auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_token_hash bytea NOT NULL UNIQUE,
  token_hmac_key_version smallint NOT NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('OWNER', 'CONTACT')),
  actor_id uuid,
  credential_version bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_seen_at timestamptz NOT NULL,
  idle_expires_at timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  ip_hmac bytea,
  user_agent_hmac bytea
);

CREATE TABLE app.one_time_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose app.token_purpose NOT NULL,
  subject_type text NOT NULL,
  subject_id uuid,
  token_hash bytea NOT NULL UNIQUE,
  token_hmac_key_version smallint NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (NOT (consumed_at IS NOT NULL AND revoked_at IS NOT NULL))
);

CREATE TABLE app.email_verification_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose text NOT NULL CHECK (purpose = 'ADMIN_PASSWORD_RESET_CODE'),
  owner_singleton_id boolean NOT NULL DEFAULT true CHECK (owner_singleton_id),
  workflow_id uuid NOT NULL REFERENCES app.workflows(id),
  code_hmac bytea NOT NULL UNIQUE,
  token_hmac_key_version smallint NOT NULL,
  notification_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  attempt_count smallint NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts smallint NOT NULL DEFAULT 5 CHECK (max_attempts = 5),
  consumed_at timestamptz,
  locked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
