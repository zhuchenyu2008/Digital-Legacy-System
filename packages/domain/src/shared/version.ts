export type AggregateVersion = number & { readonly __brand: "AggregateVersion" };

export function parseAggregateVersion(value: number): AggregateVersion {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError("Invalid aggregate version: expected a nonnegative safe integer");
  }

  return value as AggregateVersion;
}

export function incrementAggregateVersion(version: AggregateVersion): AggregateVersion {
  if (version === Number.MAX_SAFE_INTEGER) {
    throw new RangeError(
      "Invalid aggregate version: increment would exceed the safe integer range",
    );
  }

  return parseAggregateVersion(version + 1);
}
