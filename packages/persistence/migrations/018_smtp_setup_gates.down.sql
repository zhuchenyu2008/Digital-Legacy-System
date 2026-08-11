DROP INDEX IF EXISTS idx_system_settings_smtp_tested_at;
ALTER TABLE app.system_settings
  DROP COLUMN IF EXISTS smtp_test_request_id,
  DROP COLUMN IF EXISTS smtp_tested_at,
  DROP COLUMN IF EXISTS smtp_test_status,
  DROP COLUMN IF EXISTS smtp_configured;
