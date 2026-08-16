import type { TransactionContext } from "../ports/transaction-manager.js";

const REMINDERS = [
  { suffix: "24H", field: "reminder_24h_at", offsetMs: 24 * 60 * 60_000 },
  { suffix: "12H", field: "reminder_12h_at", offsetMs: 12 * 60 * 60_000 },
  { suffix: "5H", field: "reminder_5h_at", offsetMs: 5 * 60 * 60_000 },
  { suffix: "1H", field: "reminder_1h_at", offsetMs: 60 * 60_000 },
] as const;

export type CheckinReminderFields = Readonly<{
  reminder_24h_at: string;
  reminder_12h_at: string;
  reminder_5h_at: string;
  reminder_1h_at: string;
}>;

export async function scheduleCheckinReminders(
  tx: TransactionContext,
  input: Readonly<{
    scheduleId: string;
    aggregateVersion: number;
    now: string;
    deadlineAt: string;
  }>,
): Promise<CheckinReminderFields> {
  const deadline = Date.parse(input.deadlineAt);
  const now = Date.parse(input.now);
  if (!Number.isFinite(deadline) || !Number.isFinite(now)) {
    throw new Error("check-in reminder timestamps are invalid");
  }
  const values = Object.fromEntries(
    REMINDERS.map(({ field, offsetMs }) => [field, new Date(deadline - offsetMs).toISOString()]),
  ) as CheckinReminderFields;
  for (const { suffix, offsetMs } of REMINDERS) {
    await tx.outbox.enqueue({
      eventType: `CHECKIN_REMINDER_${suffix}_REQUESTED`,
      aggregateType: "checkin_schedule",
      aggregateId: input.scheduleId,
      payload: {
        aggregateId: input.scheduleId,
        aggregateVersion: input.aggregateVersion,
        offsetMs,
      },
      idempotencyKey: `checkin-reminder:${input.scheduleId}:${input.aggregateVersion}:${suffix}`,
      availableAt: new Date(Math.max(now, deadline - offsetMs)).toISOString(),
    });
  }
  return values;
}
