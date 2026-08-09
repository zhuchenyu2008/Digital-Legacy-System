ALTER TABLE app.notification_attempts
  DROP CONSTRAINT notification_attempts_provider_message_id_pair_check,
  DROP COLUMN provider_message_id_nonce;

ALTER TABLE app.notifications
  DROP CONSTRAINT notifications_fallback_email_pair_check,
  DROP COLUMN fallback_email_nonce,
  DROP COLUMN fallback_email_ciphertext,
  DROP COLUMN template_version;
