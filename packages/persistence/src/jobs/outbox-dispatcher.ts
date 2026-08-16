import type { JobPayload } from "@dls/application";
import type { Pool } from "pg";

import { JOB_NAMES } from "./job-names.js";

export interface JobPublisher {
  publish(name: string, payload: JobPayload): Promise<void>;
}

const EVENT_JOB_ROUTES: Readonly<Record<string, string>> = Object.freeze({
  CHECKIN_EVALUATE_REQUESTED: JOB_NAMES.CHECKIN_EVALUATE,
  WORKFLOW_FRAGMENT_SUBMITTED: JOB_NAMES.PROCESS_RELEASE_FRAGMENT,
  WORKFLOW_ADVANCE_REQUESTED: JOB_NAMES.WORKFLOW_ADVANCE,
  NOTIFICATION_DELIVER_REQUESTED: JOB_NAMES.NOTIFICATION_DELIVER,
  DELETE_PRIVATE_PACKAGE_OBJECT: JOB_NAMES.PACKAGE_OBJECT_DELETE,
  DELETE_STAGING_PACKAGE_OBJECT: JOB_NAMES.PACKAGE_OBJECT_DELETE,
  PUBLICATION_FINALIZE_REQUESTED: JOB_NAMES.PUBLICATION_FINALIZE,
  PASSWORD_RECOVERY_STARTED: JOB_NAMES.RECOVERY_EXPIRE,
  RECOVERY_EXPIRE_REQUESTED: JOB_NAMES.RECOVERY_EXPIRE,
  DEATH_CONFIRMATION_INVITATION_REQUESTED: JOB_NAMES.NOTIFICATION_MATERIALIZE,
  DEATH_CANCELLED_BY_CONTACT: JOB_NAMES.NOTIFICATION_MATERIALIZE,
  DEATH_CANCELLED_BY_OWNER: JOB_NAMES.NOTIFICATION_MATERIALIZE,
  DEATH_RELEASE_REMINDER_REQUESTED: JOB_NAMES.NOTIFICATION_MATERIALIZE,
  PUBLICATION_RELEASED_NOTIFICATION_REQUESTED: JOB_NAMES.NOTIFICATION_MATERIALIZE,
  CHECKIN_REMINDER_24H_REQUESTED: JOB_NAMES.NOTIFICATION_MATERIALIZE,
  CHECKIN_REMINDER_12H_REQUESTED: JOB_NAMES.NOTIFICATION_MATERIALIZE,
  CHECKIN_REMINDER_5H_REQUESTED: JOB_NAMES.NOTIFICATION_MATERIALIZE,
  CHECKIN_REMINDER_1H_REQUESTED: JOB_NAMES.NOTIFICATION_MATERIALIZE,
});

type OutboxIdentity = Readonly<{
  id: string;
  type: string;
  materializeNotification: boolean;
  includeEventId: boolean;
}>;

function jobIdentity(event: OutboxIdentity | undefined) {
  if (event?.includeEventId !== true) return {};
  return {
    eventId: event.id,
    ...(event.materializeNotification ? { eventType: event.type } : {}),
  };
}

function extractJobPayload(
  value: unknown,
  fallbackAggregateId: string,
  event?: OutboxIdentity,
): JobPayload {
  if (!value || typeof value !== "object") {
    return {
      aggregateId: fallbackAggregateId,
      aggregateVersion: 0,
      ...jobIdentity(event),
    };
  }
  const payload = value as Record<string, unknown>;
  if (payload.aggregateId === undefined && payload.aggregateVersion === undefined) {
    return {
      aggregateId: fallbackAggregateId,
      aggregateVersion: 0,
      ...jobIdentity(event),
    };
  }
  if (typeof payload.aggregateId !== "string") {
    throw new Error("Outbox job identity is invalid");
  }
  const legacyNotification =
    payload.aggregateVersion === undefined && event?.materializeNotification === true;
  if (!legacyNotification && !Number.isSafeInteger(payload.aggregateVersion)) {
    throw new Error("Outbox job identity is invalid");
  }
  const aggregateVersion = legacyNotification ? 0 : Number(payload.aggregateVersion);
  if (aggregateVersion < 0) throw new Error("Outbox job version is invalid");
  const contactId = payload.contactId ?? payload.denyingContactId;
  const offsetMs = Number(payload.offsetMs);
  return {
    aggregateId: payload.aggregateId,
    aggregateVersion,
    ...jobIdentity(event),
    ...(event?.materializeNotification === true && typeof contactId === "string"
      ? { contactId }
      : {}),
    ...(event?.materializeNotification === true && Number.isSafeInteger(offsetMs) && offsetMs >= 0
      ? { offsetMs }
      : {}),
  };
}

export class PgOutboxDispatcher {
  readonly #pool: Pick<Pool, "connect">;
  readonly #publisher: JobPublisher;

  constructor(pool: Pick<Pool, "connect">, publisher: JobPublisher) {
    this.#pool = pool;
    this.#publisher = publisher;
  }

  async dispatchBatch(limit = 100): Promise<number> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
      throw new RangeError("Outbox batch limit must be between 1 and 1000");
    }
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `SELECT id, event_type, aggregate_id, payload
         FROM app.domain_outbox
         WHERE published_at IS NULL AND available_at <= clock_timestamp()
         ORDER BY created_at, id
         FOR UPDATE SKIP LOCKED LIMIT $1`,
        [limit],
      );
      let dispatched = 0;
      for (const row of result.rows) {
        const eventType = String(row.event_type);
        const route = EVENT_JOB_ROUTES[eventType] ?? JOB_NAMES.OUTBOX_DISPATCH;
        const payload = extractJobPayload(row.payload, String(row.aggregate_id), {
          id: String(row.id),
          type: eventType,
          materializeNotification: route === JOB_NAMES.NOTIFICATION_MATERIALIZE,
          includeEventId:
            route === JOB_NAMES.NOTIFICATION_MATERIALIZE ||
            route === JOB_NAMES.PUBLICATION_FINALIZE,
        });
        await this.#publisher.publish(route, payload);
        await client.query(
          `UPDATE app.domain_outbox
           SET published_at = clock_timestamp()
           WHERE id = $1 AND published_at IS NULL`,
          [row.id],
        );
        dispatched += 1;
      }
      await client.query("COMMIT");
      return dispatched;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the broker or database error.
      }
      throw error;
    } finally {
      client.release();
    }
  }
}
