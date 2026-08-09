import { addExactDays, type Instant, parseInstant } from "../shared/instant.js";

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1_000;

function assertDays(days: number): void {
  if (!Number.isSafeInteger(days) || days < 1) throw new RangeError("days must be positive");
}

export function beijingDateAt(instant: Instant): string {
  const local = new Date(Date.parse(instant) + BEIJING_OFFSET_MS);
  return [
    local.getUTCFullYear().toString().padStart(4, "0"),
    (local.getUTCMonth() + 1).toString().padStart(2, "0"),
    local.getUTCDate().toString().padStart(2, "0"),
  ].join("-");
}

export function computeCheckinDeadline(lastCheckIn: Instant, intervalDays: number): Instant {
  assertDays(intervalDays);
  const local = new Date(Date.parse(lastCheckIn) + BEIJING_OFFSET_MS);
  return parseInstant(
    new Date(
      Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + intervalDays + 1) -
        BEIJING_OFFSET_MS,
    ).toISOString(),
  );
}

export function computeGraceDeadline(checkinDeadline: Instant, graceDays: number): Instant {
  return addExactDays(checkinDeadline, graceDays);
}
