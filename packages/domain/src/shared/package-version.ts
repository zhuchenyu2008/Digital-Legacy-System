export type PackageVersion = number & { readonly __brand: "PackageVersion" };

export function parsePackageVersion(value: number): PackageVersion {
  assertPackageVersion(value);
  return value;
}

export function assertPackageVersion(value: unknown): asserts value is PackageVersion {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new RangeError("Invalid package version: expected a positive safe integer");
  }
}
