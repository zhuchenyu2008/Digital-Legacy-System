import { createHash } from "node:crypto";

export type CanonicalAuditEvent = Readonly<{
  sequence: number;
  occurredAt: string;
  eventType: string;
  actorType: string;
  actorIdDigest: Uint8Array;
  aggregateType: string;
  aggregateId: string;
  payload: unknown;
  previousHash: Uint8Array;
}>;

function compareKeys(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value.normalize("NFC"));
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Audit payload contains a non-finite number");
    return JSON.stringify(value);
  }
  if (typeof value === "bigint") throw new TypeError("Audit payload cannot contain bigint");
  if (value instanceof Uint8Array) {
    return JSON.stringify(Buffer.from(value).toString("base64url"));
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([key, entry]) => [key.normalize("NFC"), entry] as const)
      .sort(([left], [right]) => compareKeys(left, right));
    for (let index = 1; index < entries.length; index += 1) {
      if (entries[index]?.[0] === entries[index - 1]?.[0]) {
        throw new TypeError("Audit payload contains duplicate Unicode keys");
      }
    }
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  throw new TypeError(`Audit payload contains unsupported value type: ${typeof value}`);
}

export function canonicalizeAuditEvent(event: CanonicalAuditEvent): Uint8Array {
  if (!Number.isSafeInteger(event.sequence) || event.sequence < 1) {
    throw new RangeError("Audit sequence must be a positive safe integer");
  }
  return new TextEncoder().encode(canonicalJson(event));
}

export function hashAuditEvent(event: CanonicalAuditEvent): Uint8Array {
  return createHash("sha256").update(canonicalizeAuditEvent(event)).digest();
}

export function hashAuditPayload(payload: unknown): Uint8Array {
  return createHash("sha256").update(canonicalJson(payload), "utf8").digest();
}
