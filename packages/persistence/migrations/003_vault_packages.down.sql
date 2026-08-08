DROP TABLE IF EXISTS app.checkin_schedules;
DROP TABLE IF EXISTS app.check_ins;
DROP TABLE IF EXISTS app.legacy_packages;
DROP TABLE IF EXISTS app.contact_key_shares;
ALTER TABLE app.vaults DROP CONSTRAINT IF EXISTS vaults_active_share_generation_fk;
DROP TABLE IF EXISTS app.share_generations;
DROP TABLE IF EXISTS app.vaults;
