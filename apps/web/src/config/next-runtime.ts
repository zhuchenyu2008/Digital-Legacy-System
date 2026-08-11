export function nextRuntime(environment: Record<string, string | undefined> = process.env) {
  const production = environment.NODE_ENV === "production";
  const testMode = environment.DLS_TEST_MODE === "true";
  if (production && testMode) {
    throw new Error(
      "Invalid web runtime configuration: DLS_TEST_MODE=true is forbidden in production",
    );
  }
  return Object.freeze({ development: !production, testMode });
}
