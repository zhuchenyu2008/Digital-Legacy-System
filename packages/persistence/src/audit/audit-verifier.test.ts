import { describe, expect, it } from "vitest";
import { hashAuditEvent } from "../../../application/src/audit/canonical-event.js";
import { type AuditChainEntry, verifyAuditChain } from "./audit-verifier.js";

const zeroHash = Uint8Array.from({ length: 32 }, () => 0);

function makeEntry(sequence: number, previousHash: Uint8Array): AuditChainEntry {
  const event = {
    sequence,
    occurredAt: `2026-08-08T08:00:0${sequence}Z`,
    eventType: "TEST",
    actorType: "SYSTEM",
    actorIdDigest: zeroHash,
    aggregateType: "test",
    aggregateId: `00000000-0000-0000-0000-00000000000${sequence}`,
    payload: { sequence },
    previousHash,
  };
  return { event, eventHash: hashAuditEvent(event) };
}

describe("audit chain verifier", () => {
  it("accepts an intact chain and independent streams", () => {
    const first = makeEntry(1, zeroHash);
    const second = makeEntry(2, first.eventHash);
    expect(verifyAuditChain([first, second])).toEqual({ valid: true, entries: 2 });

    const other = makeEntry(1, zeroHash);
    expect(verifyAuditChain([other])).toEqual({ valid: true, entries: 1 });
  });

  it.each([
    ["missing sequence", [makeEntry(1, zeroHash), makeEntry(3, zeroHash)]],
    ["duplicate sequence", [makeEntry(1, zeroHash), makeEntry(1, zeroHash)]],
  ])("rejects %s", (_name, entries) => {
    expect(() => verifyAuditChain(entries as AuditChainEntry[])).toThrow(/sequence/i);
  });

  it("rejects one-bit event tampering", () => {
    const first = makeEntry(1, zeroHash);
    const tampered = { ...first, eventHash: Uint8Array.from(first.eventHash) };
    const firstByte = tampered.eventHash[0];
    if (firstByte === undefined) throw new Error("test event hash is empty");
    tampered.eventHash[0] = firstByte ^ 1;

    expect(() => verifyAuditChain([tampered])).toThrow(/hash/i);
  });
});
