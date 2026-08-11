ALTER TABLE app.system_settings
  ADD COLUMN smtp_configured boolean NOT NULL DEFAULT false,
  ADD COLUMN smtp_test_status text CHECK (smtp_test_status IN ('SUCCESS', 'FAILED', 'PENDING')),
  ADD COLUMN smtp_tested_at timestamptz,
  ADD COLUMN smtp_test_request_id uuid;

CREATE INDEX idx_system_settings_smtp_tested_at
  ON app.system_settings (smtp_tested_at);
