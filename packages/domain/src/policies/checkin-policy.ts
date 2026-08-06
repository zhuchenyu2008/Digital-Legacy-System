import { addExactDays, type Instant } from "../shared/instant.js";

export function computeCheckinDeadline(lastCheckIn: Instant, intervalDays: number): Instant {
  return addExactDays(lastCheckIn, intervalDays);
}

export function computeGraceDeadline(checkinDeadline: Instant, graceDays: number): Instant {
  return addExactDays(checkinDeadline, graceDays);
}
