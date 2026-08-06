import { describe, expect, test } from "vitest";
import { parseAggregateId } from "../shared/aggregate-id.js";
import { type Instant, isDue, parseInstant } from "../shared/instant.js";
import { incrementAggregateVersion, parseAggregateVersion } from "../shared/version.js";
import { computeCheckinDeadline, computeGraceDeadline } from "./checkin-policy.js";
import { computeReleaseDeadline } from "./release-policy.js";
import { validateThreshold } from "./threshold-policy.js";

describe("aggregate identifiers", () => {
  test("parses a canonical UUID without changing its value", () => {
    expect(parseAggregateId("01890a5d-ac96-7cc3-98c9-0bb31376f242")).toBe(
      "01890a5d-ac96-7cc3-98c9-0bb31376f242",
    );
  });

  test.each([
    "not-a-uuid",
    "01890a5d-ac96-7cc3-98c9-0bb31376f24",
    "01890a5d-ac96-7cc3-98c9-0bb31376f24z",
  ])("rejects malformed aggregate identifier %s", (value) => {
    expect(() => parseAggregateId(value)).toThrow("aggregate ID");
  });
});

describe("instants", () => {
  test("normalizes an offset date-time to a UTC instant", () => {
    expect(parseInstant("2026-03-08T01:30:00-08:00")).toBe("2026-03-08T09:30:00Z");
  });

  test.each(["2026-03-08", "2026-02-30T00:00:00Z", "not-an-instant"])(
    "rejects invalid instant %s",
    (value) => {
      expect(() => parseInstant(value)).toThrow("instant");
    },
  );

  test("treats an exact deadline boundary as due", () => {
    const deadline = "2026-08-06T12:00:00Z" as Instant;

    expect(isDue("2026-08-06T11:59:59.999Z" as Instant, deadline)).toBe(false);
    expect(isDue(deadline, deadline)).toBe(true);
    expect(isDue("2026-08-06T12:00:00.001Z" as Instant, deadline)).toBe(true);
  });
});

describe("aggregate versions", () => {
  test("accepts zero as the initial aggregate version", () => {
    expect(parseAggregateVersion(0)).toBe(0);
  });

  test.each([-1, 1.5, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    "rejects unsafe aggregate version %s",
    (value) => {
      expect(() => parseAggregateVersion(value)).toThrow("version");
    },
  );

  test("refuses to increment beyond the safe integer range", () => {
    const maximumVersion = parseAggregateVersion(Number.MAX_SAFE_INTEGER);

    expect(() => incrementAggregateVersion(maximumVersion)).toThrow("version");
  });
});

describe("threshold policy", () => {
  test.each([
    { threshold: 1, activeContacts: 1 },
    { threshold: 2, activeContacts: 3 },
    { threshold: 5, activeContacts: 5 },
  ])("accepts $threshold of $activeContacts active contacts", ({ threshold, activeContacts }) => {
    expect(() => validateThreshold(threshold, activeContacts)).not.toThrow();
  });

  test.each([
    { threshold: 0, activeContacts: 3 },
    { threshold: 4, activeContacts: 3 },
    { threshold: 1.5, activeContacts: 3 },
    { threshold: 1, activeContacts: 0 },
    { threshold: 1, activeContacts: 1.5 },
    { threshold: Number.MAX_SAFE_INTEGER + 1, activeContacts: Number.MAX_SAFE_INTEGER + 1 },
  ])("rejects threshold $threshold for $activeContacts active contacts", (values) => {
    expect(() => validateThreshold(values.threshold, values.activeContacts)).toThrow("threshold");
  });
});

describe("deadline policies", () => {
  test("computes check-in, grace, and release deadlines as exact durations", () => {
    const lastCheckIn = parseInstant("2026-08-06T10:15:30Z");
    const checkinDeadline = computeCheckinDeadline(lastCheckIn, 30);

    expect(checkinDeadline).toBe("2026-09-05T10:15:30Z");
    expect(computeGraceDeadline(checkinDeadline, 3)).toBe("2026-09-08T10:15:30Z");
    expect(computeReleaseDeadline(checkinDeadline, 1)).toBe("2026-09-06T10:15:30Z");
  });

  test.each([
    {
      name: "US spring-forward transition",
      start: "2026-03-08T01:30:00-08:00",
      expected: "2026-03-09T09:30:00Z",
    },
    {
      name: "US fall-back transition",
      start: "2026-11-01T01:30:00-07:00",
      expected: "2026-11-02T08:30:00Z",
    },
    {
      name: "ordinary UTC date",
      start: "2026-08-06T22:00:00Z",
      expected: "2026-08-07T22:00:00Z",
    },
  ])("adds one exact day across $name", ({ start, expected }) => {
    expect(computeCheckinDeadline(parseInstant(start), 1)).toBe(expected);
  });

  test.each([0, -1, 1.5, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    "rejects unsafe day duration %s",
    (days) => {
      const instant = parseInstant("2026-08-06T00:00:00Z");

      expect(() => computeCheckinDeadline(instant, days)).toThrow("days");
      expect(() => computeGraceDeadline(instant, days)).toThrow("days");
      expect(() => computeReleaseDeadline(instant, days)).toThrow("days");
    },
  );
});
