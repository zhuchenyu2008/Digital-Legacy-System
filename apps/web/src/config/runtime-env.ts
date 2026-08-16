export function isDevelopmentRuntime(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return environment.NODE_ENV === "development";
}
