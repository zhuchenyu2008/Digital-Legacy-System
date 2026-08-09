ALTER TABLE app.workflow_contacts
  DROP CONSTRAINT workflow_contacts_workflow_share_index_unique,
  DROP CONSTRAINT workflow_contacts_email_key_version_check,
  DROP CONSTRAINT workflow_contacts_display_key_version_check,
  DROP CONSTRAINT workflow_contacts_share_index_check,
  DROP COLUMN email_snapshot_lookup_hmac,
  DROP COLUMN email_snapshot_key_version,
  DROP COLUMN email_snapshot_nonce,
  DROP COLUMN email_snapshot_ciphertext,
  DROP COLUMN display_name_snapshot_key_version,
  DROP COLUMN display_name_snapshot_nonce,
  DROP COLUMN display_name_snapshot_ciphertext,
  DROP COLUMN share_index;

ALTER TABLE app.workflows
  DROP CONSTRAINT workflows_owner_display_key_version_check,
  DROP CONSTRAINT workflows_schedule_version_snapshot_check,
  DROP CONSTRAINT workflows_package_version_snapshot_check,
  ALTER COLUMN package_id DROP NOT NULL,
  DROP COLUMN owner_display_name_snapshot_key_version,
  DROP COLUMN owner_display_name_snapshot_nonce,
  DROP COLUMN owner_display_name_snapshot_ciphertext,
  DROP COLUMN deadline_snapshot_at,
  DROP COLUMN schedule_version_snapshot,
  DROP COLUMN package_version_snapshot;

ALTER TABLE app.checkin_schedules
  DROP CONSTRAINT checkin_schedules_version_check,
  DROP COLUMN version;
