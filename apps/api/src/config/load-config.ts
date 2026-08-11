import { parseRuntimeConfig, type RuntimeConfig } from "@dls/contracts";
import { getApiRuntimeConfig } from "./api-runtime-config.js";

export type ApiProcessConfig = Readonly<{
  runtime: RuntimeConfig;
  host: "0.0.0.0" | "127.0.0.1";
  port: number;
}>;

export function loadApiConfig(
  environment: Record<string, string | undefined> = process.env,
): ApiProcessConfig {
  getApiRuntimeConfig(environment);
  const port = Number(environment.API_PORT ?? "3001");
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("Invalid runtime configuration: API_PORT: must be an integer from 1 to 65535");
  }

  return Object.freeze({
    runtime: parseRuntimeConfig(environment),
    host: environment.RUNNING_IN_CONTAINER === "true" ? "0.0.0.0" : "127.0.0.1",
    port,
  });
}
