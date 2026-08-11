export type SimulationRuntimeConfig =
  | Readonly<{ enabled: false }>
  | Readonly<{
      enabled: true;
      databaseUrl: string;
      storageRoot: string;
      allowedRecipients: readonly string[];
    }>;

function configured(value: string | undefined, name: string): string {
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${name} is required when simulation mode is enabled`);
  }
  return value.trim();
}

export function getSimulationRuntimeConfig(
  environment: Record<string, string | undefined> = process.env,
): SimulationRuntimeConfig {
  if (environment.DLS_SIMULATION_MODE !== "enabled") return Object.freeze({ enabled: false });
  if (environment.DLS_TEST_MODE !== "true") {
    throw new Error("simulation mode requires DLS_TEST_MODE=true");
  }
  if (environment.NODE_ENV !== "test") {
    throw new Error("simulation mode may only run in the test environment");
  }
  const formalDatabaseUrl = configured(environment.DATABASE_URL, "DATABASE_URL");
  const databaseUrl = configured(environment.SIMULATION_DATABASE_URL, "SIMULATION_DATABASE_URL");
  if (new URL(databaseUrl).href === new URL(formalDatabaseUrl).href) {
    throw new Error("simulation mode requires a separate database");
  }
  const mailTransport = new URL(configured(environment.MAIL_TRANSPORT_URL, "MAIL_TRANSPORT_URL"));
  if (
    mailTransport.protocol !== "smtp:" ||
    !["mailpit", "127.0.0.1", "localhost"].includes(mailTransport.hostname)
  ) {
    throw new Error("simulation mail transport must target Mailpit");
  }
  const storageRoot = configured(environment.SIMULATION_STORAGE_ROOT, "SIMULATION_STORAGE_ROOT");
  if (!/(?:^|[\\/])simulations(?:[\\/]|$)/iu.test(storageRoot)) {
    throw new Error("simulation storage root must be inside a simulations directory");
  }
  const allowedRecipients = Object.freeze(
    (environment.SIMULATION_MAIL_ALLOWLIST ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
  );
  if (allowedRecipients.length === 0) {
    throw new Error("simulation mail allowlist must not be empty");
  }
  return Object.freeze({ enabled: true, databaseUrl, storageRoot, allowedRecipients });
}
