import { Buffer } from "node:buffer";

export type FieldKeyring = Readonly<{
  formatVersion: 1;
  activeVersion: number;
  lookupKey: Uint8Array;
  lookupKeys: ReadonlyMap<number, Uint8Array>;
  keys: ReadonlyMap<number, Uint8Array>;
}>;

function decode(value: unknown, label: string): Uint8Array {
  if (
    typeof value !== "string" ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)
  ) {
    throw new Error(`Invalid FIELD_KEYRING: ${label} must be canonical base64`);
  }
  const decoded = Uint8Array.from(Buffer.from(value, "base64"));
  if (decoded.length !== 32 || Buffer.from(decoded).toString("base64") !== value) {
    decoded.fill(0);
    throw new Error(`Invalid FIELD_KEYRING: ${label} must decode to 32 bytes`);
  }
  return decoded;
}

function positiveVersion(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new Error(`Invalid FIELD_KEYRING: ${label} must be a positive integer`);
  }
  return Number(value);
}

export function parseFieldKeyring(value: string, variable = "FIELD_KEYRING"): FieldKeyring {
  let parsed: Readonly<Record<string, unknown>>;
  try {
    parsed = JSON.parse(value) as Readonly<Record<string, unknown>>;
  } catch {
    throw new Error(`Invalid ${variable}: must be JSON keyring data`);
  }
  if (parsed.version !== 1 || typeof parsed.keys !== "object" || parsed.keys === null) {
    throw new Error(`Invalid ${variable}: unsupported keyring format`);
  }
  const activeVersion = positiveVersion(parsed.activeVersion, "activeVersion");
  const lookupKey = decode(parsed.lookupKey, "lookupKey");
  const lookupEntries =
    typeof parsed.lookupKeys === "object" && parsed.lookupKeys !== null
      ? Object.entries(parsed.lookupKeys as Record<string, unknown>)
      : [[String(activeVersion), parsed.lookupKey] as [string, unknown]];
  const entries = Object.entries(parsed.keys as Record<string, unknown>);
  if (entries.length === 0) {
    lookupKey.fill(0);
    throw new Error(`Invalid ${variable}: at least one encryption key is required`);
  }
  if (lookupEntries.length === 0) {
    lookupKey.fill(0);
    throw new Error(`Invalid ${variable}: at least one lookup key is required`);
  }
  const keys = new Map<number, Uint8Array>();
  const lookupKeys = new Map<number, Uint8Array>();
  try {
    for (const [version, encoded] of entries) {
      const keyVersion = positiveVersion(Number(version), "key version");
      if (keys.has(keyVersion)) throw new Error(`Invalid ${variable}: duplicate key version`);
      keys.set(keyVersion, decode(encoded, `keys.${version}`));
    }
    for (const [version, encoded] of lookupEntries) {
      const keyVersion = positiveVersion(Number(version), "lookup key version");
      if (lookupKeys.has(keyVersion)) {
        throw new Error(`Invalid ${variable}: duplicate lookup key version`);
      }
      lookupKeys.set(keyVersion, decode(encoded, `lookupKeys.${version}`));
    }
    if (!keys.has(activeVersion)) {
      throw new Error(`Invalid ${variable}: activeVersion is not present in keys`);
    }
    if (!lookupKeys.has(activeVersion)) {
      throw new Error(`Invalid ${variable}: activeVersion is not present in lookupKeys`);
    }
    const activeLookupKey = lookupKeys.get(activeVersion);
    if (activeLookupKey === undefined || !Buffer.from(activeLookupKey).equals(lookupKey)) {
      throw new Error(`Invalid ${variable}: lookupKey must match lookupKeys.activeVersion`);
    }
    return Object.freeze({ formatVersion: 1, activeVersion, lookupKey, lookupKeys, keys });
  } catch (error) {
    lookupKey.fill(0);
    for (const key of lookupKeys.values()) key.fill(0);
    for (const key of keys.values()) key.fill(0);
    throw error;
  }
}

export function serializeFieldKeyring(keyring: FieldKeyring): string {
  const keys = Object.fromEntries(
    [...keyring.keys.entries()]
      .sort(([left], [right]) => left - right)
      .map(([version, key]) => [version, Buffer.from(key).toString("base64")]),
  );
  return JSON.stringify({
    version: keyring.formatVersion,
    activeVersion: keyring.activeVersion,
    lookupKey: Buffer.from(keyring.lookupKey).toString("base64"),
    lookupKeys: Object.fromEntries(
      [...keyring.lookupKeys.entries()]
        .sort(([left], [right]) => left - right)
        .map(([version, key]) => [version, Buffer.from(key).toString("base64")]),
    ),
    keys,
  });
}
