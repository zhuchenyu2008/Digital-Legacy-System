export function nextRuntime(environment: Record<string, string | undefined> = process.env) {
  return Object.freeze({ development: environment.NODE_ENV !== "production" });
}
