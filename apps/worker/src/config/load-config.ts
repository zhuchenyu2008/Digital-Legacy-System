import { parseRuntimeConfig, type RuntimeConfig } from "@dls/contracts";

export function loadWorkerConfig(
  environment: Record<string, string | undefined> = process.env,
): RuntimeConfig {
  return parseRuntimeConfig(environment);
}
