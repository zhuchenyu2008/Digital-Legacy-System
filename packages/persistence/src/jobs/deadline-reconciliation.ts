import type { Pool } from "pg";

export type DeadlineReconciliationResult = Readonly<{
  checkins: number;
  releases: number;
  recoveries: number;
}>;

type Queryable = Pick<Pool, "query">;

async function enqueue(database: Queryable, sql: string, eventType: string): Promise<number> {
  const result = await database.query(sql, [eventType]);
  return result.rowCount ?? 0;
}

/**
 * Repairs missing deadline jobs from durable aggregate state. Every insert has
 * a versioned idempotency key, so concurrent scanners and crash retries are safe.
 */
export async function reconcileDueDeadlines(
  database: Queryable,
): Promise<DeadlineReconciliationResult> {
  const checkins = await enqueue(
    database,
    `INSERT INTO app.domain_outbox
       (event_type, aggregate_type, aggregate_id, payload, idempotency_key, available_at)
     SELECT $1, 'checkin_schedule', schedule.id,
            jsonb_build_object('aggregateId', schedule.id::text,
                               'aggregateVersion', schedule.schedule_version),
            'deadline-scan:checkin:' || schedule.id::text || ':' || schedule.schedule_version::text,
            clock_timestamp()
     FROM app.checkin_schedules AS schedule
     WHERE schedule.status = 'ACTIVE' AND schedule.deadline_at <= clock_timestamp()
     ON CONFLICT (idempotency_key) DO NOTHING`,
    "CHECKIN_EVALUATE_REQUESTED",
  );
  const releases = await enqueue(
    database,
    `INSERT INTO app.domain_outbox
       (event_type, aggregate_type, aggregate_id, payload, idempotency_key, available_at)
     SELECT $1, 'workflow', workflow.id,
            jsonb_build_object('aggregateId', workflow.id::text,
                               'aggregateVersion', workflow.version),
            'deadline-scan:release:' || workflow.id::text || ':' || workflow.version::text,
            clock_timestamp()
     FROM app.workflows AS workflow
     WHERE workflow.kind = 'DEATH_CONFIRMATION'
       AND workflow.state = 'RELEASE_PENDING'
       AND workflow.publish_locked_at IS NULL
       AND workflow.release_at <= clock_timestamp()
     ON CONFLICT (idempotency_key) DO NOTHING`,
    "WORKFLOW_ADVANCE_REQUESTED",
  );
  const recoveries = await enqueue(
    database,
    `INSERT INTO app.domain_outbox
       (event_type, aggregate_type, aggregate_id, payload, idempotency_key, available_at)
     SELECT $1, 'workflow', workflow.id,
            jsonb_build_object('aggregateId', workflow.id::text,
                               'aggregateVersion', workflow.version),
            'deadline-scan:recovery:' || workflow.id::text || ':' || workflow.version::text,
            clock_timestamp()
     FROM app.workflows AS workflow
     WHERE workflow.kind = 'PASSWORD_RECOVERY'
       AND workflow.state NOT IN ('COMPLETED', 'CANCELLED', 'EXPIRED', 'RELEASED')
       AND workflow.expires_at <= clock_timestamp()
     ON CONFLICT (idempotency_key) DO NOTHING`,
    "RECOVERY_EXPIRE_REQUESTED",
  );
  await database.query(
    `INSERT INTO app.worker_heartbeats (service, last_seen_at, version, updated_at)
     VALUES ('deadline-scanner', clock_timestamp(), '1', clock_timestamp())
     ON CONFLICT (service) DO UPDATE
     SET last_seen_at = EXCLUDED.last_seen_at,
         version = EXCLUDED.version,
         updated_at = EXCLUDED.updated_at`,
  );
  return { checkins, releases, recoveries };
}
