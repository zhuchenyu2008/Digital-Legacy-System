ALTER TABLE app.checkin_schedules
  ADD COLUMN version bigint NOT NULL DEFAULT 0,
  ADD CONSTRAINT checkin_schedules_version_check CHECK (version >= 0);

ALTER TABLE app.workflows
  ADD COLUMN package_version_snapshot integer,
  ADD COLUMN schedule_version_snapshot bigint,
  ADD COLUMN deadline_snapshot_at timestamptz,
  ADD COLUMN owner_display_name_snapshot_ciphertext bytea,
  ADD COLUMN owner_display_name_snapshot_nonce bytea,
  ADD COLUMN owner_display_name_snapshot_key_version smallint;

UPDATE app.workflows AS workflow
SET package_id = COALESCE(workflow.package_id, package.id),
    package_version_snapshot = package.version_no,
    schedule_version_snapshot = schedule.schedule_version,
    deadline_snapshot_at = schedule.deadline_at,
    owner_display_name_snapshot_ciphertext = owner.display_name_ciphertext,
    owner_display_name_snapshot_nonce = owner.display_name_nonce,
    owner_display_name_snapshot_key_version = owner.display_name_key_version
FROM app.owner_profile AS owner,
     LATERAL (
       SELECT id, version_no
       FROM app.legacy_packages
       WHERE status = 'ACTIVE'
       ORDER BY version_no DESC
       LIMIT 1
     ) AS package,
     LATERAL (
       SELECT schedule_version, deadline_at
       FROM app.checkin_schedules
       ORDER BY schedule_version DESC
       LIMIT 1
     ) AS schedule;

ALTER TABLE app.workflows
  ALTER COLUMN package_id SET NOT NULL,
  ALTER COLUMN package_version_snapshot SET NOT NULL,
  ALTER COLUMN schedule_version_snapshot SET NOT NULL,
  ALTER COLUMN deadline_snapshot_at SET NOT NULL,
  ALTER COLUMN owner_display_name_snapshot_ciphertext SET NOT NULL,
  ALTER COLUMN owner_display_name_snapshot_nonce SET NOT NULL,
  ALTER COLUMN owner_display_name_snapshot_key_version SET NOT NULL,
  ADD CONSTRAINT workflows_package_version_snapshot_check CHECK (package_version_snapshot > 0),
  ADD CONSTRAINT workflows_schedule_version_snapshot_check CHECK (schedule_version_snapshot > 0),
  ADD CONSTRAINT workflows_owner_display_key_version_check
    CHECK (owner_display_name_snapshot_key_version > 0);

ALTER TABLE app.workflow_contacts
  ADD COLUMN share_index smallint,
  ADD COLUMN display_name_snapshot_ciphertext bytea,
  ADD COLUMN display_name_snapshot_nonce bytea,
  ADD COLUMN display_name_snapshot_key_version smallint,
  ADD COLUMN email_snapshot_ciphertext bytea,
  ADD COLUMN email_snapshot_nonce bytea,
  ADD COLUMN email_snapshot_key_version smallint,
  ADD COLUMN email_snapshot_lookup_hmac bytea;

UPDATE app.workflow_contacts AS snapshot
SET share_index = share.share_index,
    display_name_snapshot_ciphertext = contact.display_name_ciphertext,
    display_name_snapshot_nonce = contact.display_name_nonce,
    display_name_snapshot_key_version = contact.display_name_key_version,
    email_snapshot_ciphertext = contact.email_ciphertext,
    email_snapshot_nonce = contact.email_nonce,
    email_snapshot_key_version = contact.email_key_version,
    email_snapshot_lookup_hmac = contact.email_lookup_hmac
FROM app.emergency_contacts AS contact,
     app.workflows AS workflow,
     app.contact_key_shares AS share
WHERE snapshot.contact_id = contact.id
  AND snapshot.workflow_id = workflow.id
  AND share.generation_id = workflow.share_generation_id
  AND share.contact_id = snapshot.contact_id;

ALTER TABLE app.workflow_contacts
  ALTER COLUMN share_index SET NOT NULL,
  ALTER COLUMN display_name_snapshot_ciphertext SET NOT NULL,
  ALTER COLUMN display_name_snapshot_nonce SET NOT NULL,
  ALTER COLUMN display_name_snapshot_key_version SET NOT NULL,
  ALTER COLUMN email_snapshot_ciphertext SET NOT NULL,
  ALTER COLUMN email_snapshot_nonce SET NOT NULL,
  ALTER COLUMN email_snapshot_key_version SET NOT NULL,
  ALTER COLUMN email_snapshot_lookup_hmac SET NOT NULL,
  ADD CONSTRAINT workflow_contacts_share_index_check CHECK (share_index > 0),
  ADD CONSTRAINT workflow_contacts_display_key_version_check
    CHECK (display_name_snapshot_key_version > 0),
  ADD CONSTRAINT workflow_contacts_email_key_version_check
    CHECK (email_snapshot_key_version > 0),
  ADD CONSTRAINT workflow_contacts_workflow_share_index_unique UNIQUE (workflow_id, share_index);
