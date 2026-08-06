import { addExactDays, type Instant } from "../shared/instant.js";

export function computeReleaseDeadline(triggeredAt: Instant, delayDays: number): Instant {
  return addExactDays(triggeredAt, delayDays);
}
