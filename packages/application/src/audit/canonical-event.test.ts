import { describe, expect, it } from "vitest";

import { canonicalizeAuditEvent, hashAuditEvent } from "./canonical-event.js";

const previousHash = Uint8Array.from({ length: 32 }, () => 0);

function event(overrides: Record<string, unknown> = {}) {
  return {
    sequence: 1,
    occurredAt: "2026-08-08T08:00:00Z",
    eventType: "OWNER_LOGIN",
    actorType: "OWNER",
    actorIdDigest: Uint8Array.from({ length: 32 }, () => 1),
    aggregateType: "owner",
    aggregateId: "00000000-0000-0000-0000-000000000001",
    payload: { z: "last", a: "first" },
    previousHash,
    ...overrides,
  };
}

describe("canonical audit events", () => {
  it("produces identical bytes regardless of object key order", () => {
    const left = event({ payload: { z: "last", a: "first" } });
    const right = event({ payload: { a: "first", z: "last" } });

    expect(canonicalizeAuditEvent(left)).toEqual(canonicalizeAuditEvent(right));
    expect(hashAuditEvent(left)).toEqual(hashAuditEvent(right));
  });

  it("normalizes Unicode strings to NFC before hashing", () => {
    const composed = event({ payload: { message: "é" } });
    const decomposed = event({ payload: { message: "e\u0301" } });

    expect(canonicalizeAuditEvent(composed)).toEqual(canonicalizeAuditEvent(decomposed));
  });

  it("binds sequence and previous hash into the event digest", () => {
    expect(hashAuditEvent(event({ sequence: 2 }))).not.toEqual(hashAuditEvent(event()));
    expect(
      hashAuditEvent(event({ previousHash: Uint8Array.from({ length: 32 }, () => 9) })),
    ).not.toEqual(hashAuditEvent(event()));
  });
});
