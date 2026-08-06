import { Temporal } from "@js-temporal/polyfill";

export type Instant = string & { readonly __brand: "Instant" };

export function parseInstant(value: string): Instant {
  try {
    return Temporal.Instant.from(value).toString() as Instant;
  } catch (error) {
    throw new TypeError("Invalid instant: expected an ISO 8601 date-time with an offset", {
      cause: error,
    });
  }
}

export function addExactDays(instant: Instant, days: number): Instant {
  assertPositiveSafeInteger(days, "days");

  try {
    return Temporal.Instant.from(instant)
      .add({ hours: days * 24 })
      .toString() as Instant;
  } catch (error) {
    throw new RangeError("Invalid days: duration exceeds the supported instant range", {
      cause: error,
    });
  }
}

export function isDue(now: Instant, deadline: Instant): boolean {
  return Temporal.Instant.compare(now, deadline) >= 0;
}

function assertPositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`Invalid ${name}: expected a positive safe integer`);
  }
}
