CREATE UNIQUE INDEX uq_active_contact_name
  ON app.emergency_contacts (display_name_lookup_hmac)
  WHERE status <> 'REMOVED';
CREATE UNIQUE INDEX uq_active_contact_email
  ON app.emergency_contacts (email_lookup_hmac)
  WHERE status <> 'REMOVED';
CREATE UNIQUE INDEX uq_one_active_share_generation
  ON app.share_generations (vault_id)
  WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX uq_one_active_package
  ON app.legacy_packages ((status))
  WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX uq_one_active_checkin_schedule
  ON app.checkin_schedules ((status))
  WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX uq_one_formal_workflow
  ON app.workflows ((true))
  WHERE state NOT IN ('COMPLETED', 'CANCELLED', 'EXPIRED', 'RELEASED');
CREATE INDEX idx_check_ins_checked_at ON app.check_ins (checked_in_at DESC);
CREATE INDEX idx_schedules_deadline ON app.checkin_schedules (status, deadline_at);
CREATE INDEX idx_contacts_status ON app.emergency_contacts (status);
CREATE INDEX idx_invitations_contact_expiry ON app.contact_invitations (contact_id, expires_at);
CREATE INDEX idx_generations_vault_status ON app.share_generations (vault_id, status);
CREATE INDEX idx_packages_status_version ON app.legacy_packages (status, version_no DESC);
CREATE INDEX idx_workflows_state_release ON app.workflows (state, release_at);
CREATE INDEX idx_workflows_kind_started ON app.workflows (kind, started_at DESC);
CREATE INDEX idx_workflow_contacts_workflow ON app.workflow_contacts (workflow_id);
CREATE INDEX idx_workflow_actions_workflow_decision ON app.workflow_contact_actions (workflow_id, decision);
CREATE INDEX idx_notifications_delivery ON app.notifications (status, next_attempt_at);
CREATE INDEX idx_outbox_delivery ON app.domain_outbox (published_at, available_at);
CREATE INDEX idx_sessions_actor ON app.auth_sessions (actor_type, actor_id, revoked_at);
CREATE INDEX idx_private_audit_occurred ON audit.private_events (occurred_at DESC);
CREATE INDEX idx_public_audit_publication ON audit.public_events (publication_id, sequence_no);

ALTER TABLE app.contact_invitations
  ADD CONSTRAINT contact_invitations_notification_fk
  FOREIGN KEY (notification_id) REFERENCES app.notifications(id);
ALTER TABLE app.email_verification_codes
  ADD CONSTRAINT email_verification_notification_fk
  FOREIGN KEY (notification_id) REFERENCES app.notifications(id);

CREATE OR REPLACE FUNCTION app.reject_immutable_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is immutable', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER publications_immutable
BEFORE UPDATE OR DELETE ON app.publications
FOR EACH ROW EXECUTE FUNCTION app.reject_immutable_mutation();

CREATE TRIGGER private_events_immutable
BEFORE UPDATE OR DELETE ON audit.private_events
FOR EACH ROW EXECUTE FUNCTION app.reject_immutable_mutation();

CREATE TRIGGER public_events_immutable
BEFORE UPDATE OR DELETE ON audit.public_events
FOR EACH ROW EXECUTE FUNCTION app.reject_immutable_mutation();

DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['dls_api', 'dls_worker', 'dls_migrator', 'dls_backup', 'dls_health'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('GRANT USAGE ON SCHEMA app, audit, infra TO %I', role_name);
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dls_migrator') THEN
    GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA app, audit, infra TO dls_migrator;
    GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA app, audit, infra TO dls_migrator;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dls_api') THEN
    GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA app TO dls_api;
    GRANT INSERT ON audit.private_events TO dls_api;
    GRANT SELECT ON infra.schema_migrations TO dls_api;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dls_worker') THEN
    GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA app TO dls_worker;
    GRANT INSERT ON audit.private_events, audit.public_events TO dls_worker;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dls_backup') THEN
    GRANT SELECT ON ALL TABLES IN SCHEMA app, audit TO dls_backup;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dls_health') THEN
    GRANT SELECT ON app.system_settings, app.checkin_schedules, app.notifications TO dls_health;
  END IF;
END $$;

REVOKE ALL ON SCHEMA public FROM PUBLIC;
