ALTER TABLE app.notifications
  ADD COLUMN template_version bigint NOT NULL DEFAULT 1 CHECK (template_version >= 1),
  ADD COLUMN fallback_email_ciphertext bytea,
  ADD COLUMN fallback_email_nonce bytea,
  ADD CONSTRAINT notifications_fallback_email_pair_check CHECK (
    (fallback_email_ciphertext IS NULL AND fallback_email_nonce IS NULL)
    OR
    (fallback_email_ciphertext IS NOT NULL AND fallback_email_nonce IS NOT NULL)
  );

ALTER TABLE app.notification_attempts
  ADD COLUMN provider_message_id_nonce bytea,
  ADD CONSTRAINT notification_attempts_provider_message_id_pair_check CHECK (
    (provider_message_id_ciphertext IS NULL AND provider_message_id_nonce IS NULL)
    OR
    (provider_message_id_ciphertext IS NOT NULL AND provider_message_id_nonce IS NOT NULL)
  );
