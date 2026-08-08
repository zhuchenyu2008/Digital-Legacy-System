export type CanonicalAadInput = Readonly<{
  protocol: string;
  version: number;
  purpose: string;
  vaultId: string;
  generationId?: string;
  contactId?: string;
  packageId?: string;
  packageVersion?: number;
  keyId: string;
  algorithm: string;
}>;

const REQUIRED_FIELDS = new Set([
  "protocol",
  "version",
  "purpose",
  "vaultId",
  "keyId",
  "algorithm",
]);
const OPTIONAL_FIELDS = new Set(["generationId", "contactId", "packageId", "packageVersion"]);

function assertAad(input: CanonicalAadInput): void {
  if (input === null || typeof input !== "object") throw new TypeError("AAD must be an object");
  const keys = Object.keys(input as object);
  for (const key of keys) {
    if (!REQUIRED_FIELDS.has(key) && !OPTIONAL_FIELDS.has(key)) {
      throw new Error(`Unknown AAD field: ${key}`);
    }
  }
  for (const key of REQUIRED_FIELDS) {
    if (!(key in input)) throw new Error(`Missing AAD field: ${key}`);
  }
  for (const key of ["protocol", "purpose", "vaultId", "keyId", "algorithm"] as const) {
    if (typeof input[key] !== "string" || input[key].length === 0) {
      throw new Error(`AAD field ${key} must be a non-empty string`);
    }
  }
  if (!Number.isSafeInteger(input.version) || input.version < 1) {
    throw new Error("AAD version must be a positive safe integer");
  }
  for (const key of ["generationId", "contactId", "packageId"] as const) {
    if (key in input && (typeof input[key] !== "string" || input[key].length === 0)) {
      throw new Error(`AAD field ${key} must be a non-empty string`);
    }
  }
  if (
    "packageVersion" in input &&
    (!Number.isSafeInteger(input.packageVersion) || (input.packageVersion ?? 0) < 1)
  ) {
    throw new Error("AAD packageVersion must be a positive safe integer");
  }
}

export function canonicalizeAad(input: CanonicalAadInput): Uint8Array {
  assertAad(input);
  const record: Record<string, string | number> = {};
  for (const key of Object.keys(input).sort()) {
    const value = input[key as keyof CanonicalAadInput];
    if (value !== undefined) record[key] = value;
  }
  return new TextEncoder().encode(JSON.stringify(record));
}
