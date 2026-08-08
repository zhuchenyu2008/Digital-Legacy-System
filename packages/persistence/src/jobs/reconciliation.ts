import type { Pool } from "pg";

export async function countUndispatchedOutbox(
  pool: Pick<Pool, "query">,
  olderThanSeconds = 60,
): Promise<number> {
  if (!Number.isSafeInteger(olderThanSeconds) || olderThanSeconds < 1) {
    throw new RangeError("Reconciliation age must be a positive safe integer");
  }
  const result = await pool.query(
    `SELECT count(*)::int AS count
     FROM app.domain_outbox
     WHERE published_at IS NULL
       AND created_at < clock_timestamp() - ($1 * interval '1 second')`,
    [olderThanSeconds],
  );
  return Number(result.rows[0]?.count ?? 0);
}
