SELECT jsonb_build_object(
  'version', 1,
  'schemaVersion', COALESCE((SELECT max(version) FROM infra.schema_migrations), 0),
  'counts', jsonb_build_object(
    'vaults', (SELECT count(*) FROM app.vaults),
    'shareGenerations', (SELECT count(*) FROM app.share_generations),
    'contacts', (SELECT count(*) FROM app.emergency_contacts),
    'packages', (SELECT count(*) FROM app.legacy_packages),
    'workflows', (SELECT count(*) FROM app.workflows),
    'publications', (SELECT count(*) FROM app.publications),
    'notifications', (SELECT count(*) FROM app.notifications),
    'outbox', (SELECT count(*) FROM app.domain_outbox),
    'privateAudit', (SELECT count(*) FROM audit.private_events),
    'publicAudit', (SELECT count(*) FROM audit.public_events)
  ),
  'packages', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', id,
      'status', status,
      'objectKey', object_key,
      'bytes', ciphertext_size,
      'sha256', encode(ciphertext_sha256, 'hex')
    ) ORDER BY id)
    FROM app.legacy_packages
  ), '[]'::jsonb),
  'publications', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', id,
      'packageId', package_id,
      'objectKey', public_object_key,
      'bytes', zip_size,
      'sha256', encode(zip_sha256, 'hex'),
      'auditHash', encode(public_audit_final_hash, 'hex')
    ) ORDER BY id)
    FROM app.publications
  ), '[]'::jsonb),
  'privateAuditFinalHash', COALESCE((
    SELECT encode(event_hash, 'hex') FROM audit.private_events ORDER BY sequence_no DESC LIMIT 1
  ), ''),
  'publicAuditFinalHashes', COALESCE((
    SELECT jsonb_object_agg(publication_id::text, final_hash)
    FROM (
      SELECT DISTINCT ON (publication_id) publication_id, encode(event_hash, 'hex') AS final_hash
      FROM audit.public_events
      ORDER BY publication_id, sequence_no DESC
    ) AS final_public_events
  ), '{}'::jsonb),
  'outbox', jsonb_build_object(
    'pending', (SELECT count(*) FROM app.domain_outbox WHERE published_at IS NULL),
    'published', (SELECT count(*) FROM app.domain_outbox WHERE published_at IS NOT NULL)
  ),
  'jobs', COALESCE((
    SELECT jsonb_object_agg(state::text, state_count)
    FROM (
      SELECT state, count(*) AS state_count
      FROM pgboss.job
      GROUP BY state
    ) AS job_counts
  ), '{}'::jsonb)
)::text;
