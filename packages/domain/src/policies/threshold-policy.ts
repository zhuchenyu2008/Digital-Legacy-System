export function validateThreshold(threshold: number, activeContacts: number): void {
  if (
    !Number.isSafeInteger(threshold) ||
    !Number.isSafeInteger(activeContacts) ||
    threshold < 1 ||
    activeContacts < 1 ||
    threshold > activeContacts
  ) {
    throw new RangeError(
      "Invalid threshold: expected positive safe integers with threshold <= active contacts",
    );
  }
}
