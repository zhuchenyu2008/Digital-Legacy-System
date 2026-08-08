CREATE TABLE app.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_code text NOT NULL,
  recipient_type text NOT NULL CHECK (recipient_type IN ('OWNER_PRIMARY', 'OWNER_BACKUP', 'CONTACT')),
  recipient_ref uuid,
  recipient_email_ciphertext bytea NOT NULL,
  recipient_email_nonce bytea NOT NULL,
  subject_ciphertext bytea NOT NULL,
  subject_nonce bytea NOT NULL,
  template_data_ciphertext bytea NOT NULL,
  template_data_nonce bytea NOT NULL,
  status app.notification_status NOT NULL DEFAULT 'QUEUED',
  idempotency_key text NOT NULL UNIQUE,
  attempt_count smallint NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at timestamptz NOT NULL,
  sent_at timestamptz,
  failed_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0)
);

CREATE TABLE app.notification_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL REFERENCES app.notifications(id),
  attempt_no smallint NOT NULL CHECK (attempt_no >= 0),
  target_kind text NOT NULL CHECK (target_kind IN ('PRIMARY', 'BACKUP', 'CONTACT')),
  started_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL,
  result text NOT NULL CHECK (result IN ('ACCEPTED', 'TEMP_FAIL', 'PERM_FAIL')),
  smtp_status_class smallint CHECK (smtp_status_class BETWEEN 2 AND 5),
  provider_message_id_ciphertext bytea,
  error_code text,
  UNIQUE (notification_id, attempt_no, target_kind)
);

CREATE TABLE app.domain_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  payload jsonb NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE app.publications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL UNIQUE REFERENCES app.workflows(id),
  package_id uuid NOT NULL UNIQUE REFERENCES app.legacy_packages(id),
  public_slug text NOT NULL UNIQUE,
  public_object_key text NOT NULL UNIQUE,
  zip_size bigint NOT NULL CHECK (zip_size >= 0),
  zip_sha256 bytea NOT NULL,
  will_markdown_sha256 bytea NOT NULL,
  will_html_sanitized text NOT NULL,
  public_audit_final_hash bytea NOT NULL,
  published_at timestamptz NOT NULL,
  visible_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE app.email_template_overrides (
  template_code text PRIMARY KEY,
  subject_template_ciphertext bytea NOT NULL,
  subject_template_nonce bytea NOT NULL,
  body_markdown_ciphertext bytea NOT NULL,
  body_markdown_nonce bytea NOT NULL,
  allowed_variables text[] NOT NULL,
  template_version bigint NOT NULL CHECK (template_version >= 1),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE app.rate_limit_buckets (
  bucket_key bytea PRIMARY KEY,
  window_started_at timestamptz NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  blocked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE audit.private_events (
  sequence_no bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id uuid NOT NULL UNIQUE,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  event_type text NOT NULL,
  actor_type text NOT NULL,
  actor_pseudonym bytea,
  target_type text,
  target_id uuid,
  result text NOT NULL CHECK (result IN ('SUCCESS', 'DENIED', 'FAILURE')),
  request_id uuid,
  ip_ciphertext bytea,
  ip_nonce bytea,
  ip_key_version smallint,
  user_agent_ciphertext bytea,
  user_agent_nonce bytea,
  user_agent_key_version smallint,
  metadata_ciphertext bytea,
  metadata_nonce bytea,
  metadata_key_version smallint,
  previous_hash bytea NOT NULL,
  event_hash bytea NOT NULL UNIQUE
);

CREATE TABLE audit.public_events (
  publication_id uuid NOT NULL REFERENCES app.publications(id),
  sequence_no integer NOT NULL CHECK (sequence_no >= 1),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  event_code text NOT NULL,
  public_message text NOT NULL,
  public_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  previous_hash bytea NOT NULL,
  event_hash bytea NOT NULL,
  PRIMARY KEY (publication_id, sequence_no),
  UNIQUE (publication_id, event_hash)
);
